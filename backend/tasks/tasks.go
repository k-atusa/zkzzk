package tasks

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/k-atusa/zkzzk/backend/chzzk"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/httpx"
	"github.com/k-atusa/zkzzk/backend/notify"
	"github.com/k-atusa/zkzzk/backend/youtube"
)

// Service polls active Chzzk streamers, runs streamlink recordings, remuxes to MP4, and triggers YouTube uploads.
type Service struct {
	store   *db.Store
	cfg     *config.Config
	youtube *youtube.Service

	mu         sync.Mutex
	checking   map[string]bool
	activeCmds map[string]*exec.Cmd
}

// NewService creates a Tasks Service.
func NewService(store *db.Store, cfg *config.Config, yt *youtube.Service) *Service {
	return &Service{
		store:      store,
		cfg:        cfg,
		youtube:    yt,
		checking:   make(map[string]bool),
		activeCmds: make(map[string]*exec.Cmd),
	}
}

// Start cleans up orphaned recording statuses from any prior crash and launches the 30s live polling loop.
func (s *Service) Start(ctx context.Context) {
	s.cleanupOrphans()

	go s.checkAll()

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.checkAll()
			}
		}
	}()
}

func (s *Service) cleanupOrphans() {
	log.Println("[TasksService] Cleaning up orphan recording states & performing initial live check...")
	streamers, err := s.store.ListRecordingStreamers()
	if err != nil {
		log.Printf("[TasksService] Failed to list recording streamers during cleanup: %v", err)
	} else {
		for _, st := range streamers {
			alive := false
			if st.ProcessID != nil && *st.ProcessID > 0 {
				alive = isProcessAlive(*st.ProcessID)
			}
			if !alive {
				nick := ""
				if st.Nickname != nil {
					nick = *st.Nickname
				}
				pidVal := 0
				if st.ProcessID != nil {
					pidVal = *st.ProcessID
				}
				log.Printf("[TasksService] Resetting orphan recording status for streamer %s (pid: %d)", nick, pidVal)
				_ = s.store.ClearStreamerProcess(st.ID)
			}
		}
	}
	if err := s.store.ResetOrphanRecordings(); err != nil {
		log.Printf("[TasksService] Failed to reset orphan recording rows: %v", err)
	}
}

func (s *Service) checkAll() {
	streamers, err := s.store.ListActiveStreamers()
	if err != nil {
		log.Printf("[TasksService] Error listing active streamers: %v", err)
		return
	}
	for _, st := range streamers {
		s.CheckStreamer(st)
	}
}

// CheckStreamer checks whether a single streamer is live and starts recording if appropriate.
func (s *Service) CheckStreamer(st db.Streamer) {
	channelID := chzzk.ExtractChannelID(st.ChannelURL)
	if channelID == "" {
		return
	}

	s.mu.Lock()
	if s.checking[st.ID] {
		s.mu.Unlock()
		return
	}
	s.checking[st.ID] = true
	_, hasActiveCmd := s.activeCmds[st.ID]
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.checking, st.ID)
		s.mu.Unlock()
	}()

	nick := ""
	if st.Nickname != nil {
		nick = *st.Nickname
	}

	if st.IsRecording && !hasActiveCmd {
		alive := st.ProcessID != nil && *st.ProcessID > 0 && isProcessAlive(*st.ProcessID)
		if !alive {
			pidVal := 0
			if st.ProcessID != nil {
				pidVal = *st.ProcessID
			}
			log.Printf("[TasksService] Streamer %s was marked as recording (pid %d), but process is not alive. Resetting status.", nick, pidVal)
			st.IsRecording = false
			_ = s.store.ClearStreamerProcess(st.ID)
		}
	}

	var cookieUser *db.User
	cookieUserID := st.CookieUserID
	if cookieUserID == nil || *cookieUserID == "" {
		cookieUserID = st.UserID
	}
	if cookieUserID != nil && *cookieUserID != "" {
		cookieUser, _ = s.store.GetUserByID(*cookieUserID)
	}

	var nidAut, nidSes string
	if cookieUser != nil && cookieUser.NidAut != nil && cookieUser.NidSes != nil {
		nidAut = *cookieUser.NidAut
		nidSes = *cookieUser.NidSes
	}

	detail, err := chzzk.GetLiveDetail(channelID, nidAut, nidSes)
	if err != nil {
		log.Printf("[TasksService] Error checking streamer %s: %v", nick, err)
		return
	}
	if detail.Code != 200 {
		return
	}

	if detail.Status == "OPEN" {
		var catPtr *string
		if detail.CatVal != "" {
			c := detail.CatVal
			catPtr = &c
		}
		var tagsJSONPtr *string
		if detail.Tags != nil {
			if b, err := json.Marshal(detail.Tags); err == nil {
				str := string(b)
				tagsJSONPtr = &str
			}
		}
		_ = s.store.UpdateStreamerLiveChecked(st.ID, detail.Title, catPtr, tagsJSONPtr)

		if !st.IsRecording && !st.IsPaused {
			go s.downloadStream(channelID, detail.Title, nick, st.ID, detail.CatVal, detail.Tags)
		}
	} else {
		_ = s.store.UpdateStreamerOfflineChecked(st.ID)
	}
}

func (s *Service) downloadStream(channelID, broadcastTitle, streamerNickname, streamerID, liveCategory string, tags []string) {
	s.mu.Lock()
	if _, exists := s.activeCmds[streamerID]; exists {
		s.mu.Unlock()
		return
	}
	// Reserve slot immediately before spawning external process.
	s.activeCmds[streamerID] = nil
	s.mu.Unlock()

	cleanupActive := func() {
		s.mu.Lock()
		delete(s.activeCmds, streamerID)
		s.mu.Unlock()
	}

	streamer, err := s.store.GetStreamerByID(streamerID)
	if err != nil || streamer == nil || streamer.UserID == nil || *streamer.UserID == "" {
		cleanupActive()
		return
	}
	owner, err := s.store.GetUserByID(*streamer.UserID)
	if err != nil || owner == nil || owner.Username == "" {
		cleanupActive()
		return
	}

	userDownloadsDir := filepath.Join(s.cfg.DownloadsDir, owner.Username)
	streamerDir := filepath.Join(userDownloadsDir, "live", streamerNickname)
	if err := os.MkdirAll(streamerDir, 0755); err != nil {
		log.Printf("[TasksService] Failed to create recording dir: %v", err)
		cleanupActive()
		return
	}

	now := time.Now()
	dateStr := now.Format("060102_150405")
	filename := httpx.SanitizeFilename(fmt.Sprintf("%s %s [%s].ts", dateStr, broadcastTitle, streamerNickname))
	tsPath := filepath.Join(streamerDir, filename)

	var cookieUser *db.User
	cookieUserID := streamer.CookieUserID
	if cookieUserID == nil || *cookieUserID == "" {
		cookieUserID = streamer.UserID
	}
	if cookieUserID != nil && *cookieUserID != "" {
		cookieUser, _ = s.store.GetUserByID(*cookieUserID)
	}

	formatString := resolutionToStreamlinkFormat("1080p")
	if cookieUser != nil {
		formatString = resolutionToStreamlinkFormat(cookieUser.LiveResolution)
	}

	args := []string{
		"--ffmpeg-copyts",
		"--progress", "no",
	}
	if cookieUser != nil && cookieUser.NidAut != nil && *cookieUser.NidAut != "" && cookieUser.NidSes != nil && *cookieUser.NidSes != "" {
		args = append(args, "--http-cookie", "NID_AUT="+*cookieUser.NidAut)
		args = append(args, "--http-cookie", "NID_SES="+*cookieUser.NidSes)
	}
	streamURL := fmt.Sprintf("https://chzzk.naver.com/live/%s", channelID)
	args = append(args, streamURL, formatString, "--output", tsPath)

	relTS := filepath.ToSlash(filepath.Join("live", streamerNickname, filename))
	rec, err := s.store.CreateRecording(&streamerID, *streamer.UserID, relTS, broadcastTitle, true)
	if err != nil {
		log.Printf("[TasksService] Failed to create recording row: %v", err)
		cleanupActive()
		return
	}

	streamlinkCmd := config.FindExecutable("streamlink")
	cmd := exec.Command(streamlinkCmd, args...)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("[TasksService] Streamlink stdout pipe error: %v", err)
		cleanupActive()
		_ = s.store.UpdateRecordingIsRecording(rec.ID, false)
		return
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		log.Printf("[TasksService] Streamlink stderr pipe error: %v", err)
		cleanupActive()
		_ = s.store.UpdateRecordingIsRecording(rec.ID, false)
		return
	}

	if err := cmd.Start(); err != nil {
		log.Printf("[TasksService] Failed to start streamlink: %v", err)
		cleanupActive()
		_ = s.store.ClearStreamerProcess(streamerID)
		_ = s.store.UpdateRecordingIsRecording(rec.ID, false)
		return
	}

	s.mu.Lock()
	s.activeCmds[streamerID] = cmd
	s.mu.Unlock()

	var catPtr *string
	if liveCategory != "" {
		catPtr = &liveCategory
	}
	var tagsJSONPtr *string
	if tags != nil {
		if b, err := json.Marshal(tags); err == nil {
			str := string(b)
			tagsJSONPtr = &str
		}
	}
	_ = s.store.MarkStreamerRecording(streamerID, broadcastTitle, catPtr, tagsJSONPtr, cmd.Process.Pid)

	notify.SendDiscordWebhook(s.store, *streamer.UserID, notify.Embed{
		Title:       "✅ 녹화 시작",
		Description: fmt.Sprintf("**%s**님의 녹화가 시작되었습니다.\n\n**방송 제목:** %s\n**채널 링크:** https://chzzk.naver.com/%s", streamerNickname, broadcastTitle, channelID),
		Color:       0x00FFA3,
	})

	var resOnce sync.Once
	var wg sync.WaitGroup
	readPipe := func(r io.Reader, label string) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			log.Printf("[Streamlink %s] %s", label, line)
			if resStr, ok := httpx.ParseStreamlinkResolution(line); ok {
				resOnce.Do(func() {
					_ = s.store.UpdateRecordingResolution(rec.ID, resStr)
				})
			}
		}
	}
	wg.Add(2)
	go readPipe(stdoutPipe, "stdout")
	go readPipe(stderrPipe, "stderr")
	wg.Wait()

	waitErr := cmd.Wait()
	cleanupActive()

	exitCode := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}
	log.Printf("[TasksService] Streamlink exited with code %d", exitCode)

	_ = s.store.ClearStreamerProcess(streamerID)
	notify.SendDiscordWebhook(s.store, *streamer.UserID, notify.Embed{
		Title:       "🛑 녹화 종료",
		Description: fmt.Sprintf("**%s**님의 녹화가 성공적으로 종료되었습니다.", streamerNickname),
		Color:       0xFF4D4D,
	})

	if _, statErr := os.Stat(tsPath); statErr != nil {
		_ = s.store.UpdateRecordingIsRecording(rec.ID, false)
		return
	}

	mp4Filename := strings.TrimSuffix(filename, ".ts") + ".mp4"
	mp4Path := filepath.Join(streamerDir, mp4Filename)
	ffmpegCmd := config.FindExecutable("ffmpeg")
	ff := exec.Command(ffmpegCmd,
		"-err_detect", "ignore_err",
		"-i", tsPath,
		"-c", "copy",
		"-start_at_zero",
		"-y",
		mp4Path,
	)

	if ffErr := ff.Run(); ffErr != nil {
		log.Printf("[TasksService] ffmpeg conversion failed for %s: %v", filename, ffErr)
		_ = s.store.UpdateRecordingIsRecording(rec.ID, false)
		return
	}

	_ = os.Remove(tsPath)
	relMP4 := filepath.ToSlash(filepath.Join("live", streamerNickname, mp4Filename))
	if err := s.store.UpdateRecordingFilenameAndDone(rec.ID, relMP4); err != nil {
		log.Printf("[TasksService] Failed to update recording filename: %v", err)
		return
	}

	notify.SendDiscordWebhook(s.store, *streamer.UserID, notify.Embed{
		Title:       "💽 MP4 변환 완료",
		Description: fmt.Sprintf("**%s**님의 영상이 MP4로 성공적으로 변환되었습니다.\n\n**방송 제목:** %s", streamerNickname, broadcastTitle),
		Color:       0x3498DB,
	})

	s.triggerAutoUpload(*streamer.UserID, rec.ID, mp4Path, mp4Filename, streamerNickname, liveCategory, tags)
}

func (s *Service) triggerAutoUpload(userID, recordingID, mp4Path, mp4Filename, streamerNickname, liveCategory string, tags []string) {
	user, err := s.store.GetUserByID(userID)
	if err != nil || user == nil {
		return
	}
	if user.YoutubeClientID == nil || *user.YoutubeClientID == "" ||
		user.YoutubeClientSecret == nil || *user.YoutubeClientSecret == "" ||
		user.YoutubeRefreshToken == nil || *user.YoutubeRefreshToken == "" ||
		!user.YoutubeAutoUpload {
		return
	}

	if !s.youtube.AcquireLock(mp4Path) {
		log.Printf("[TasksService] Auto-upload skipped for %s because it's already locked by another process.", mp4Filename)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	isDup, fileHash := s.youtube.CheckDuplicateVideo(ctx, user.ID, mp4Filename, mp4Path)
	if isDup {
		s.youtube.ReleaseLock(mp4Path)
		_ = s.store.UpdateRecordingYoutubeStatus(recordingID, "DUPLICATE_PENDING", nil, nil)
		notify.SendDiscordWebhook(s.store, user.ID, notify.Embed{
			Title:       "⚠️ 유튜브 업로드 대기 (중복)",
			Description: fmt.Sprintf("**%s**님의 영상과 동일한 제목의 영상이 이미 유튜브에 존재합니다.\n\n**파일명:** %s\n\n웹 서비스에 접속하여 직접 업로드 여부를 결정해주세요.", streamerNickname, mp4Filename),
			Color:       0xF39C12,
		})
		return
	}

	desc := fmt.Sprintf("Automatically uploaded via ZKZZK version %s", config.AppVersion)
	cat := liveCategory
	if cat == "" {
		cat = "20"
	}
	go s.youtube.UploadVideo(recordingID, mp4Path, mp4Filename, desc, cat, tags, user.ID, fileHash)
}

// KillStreamerProcess terminates an active recording subprocess if running.
func (s *Service) KillStreamerProcess(streamerID string, pid *int) {
	s.mu.Lock()
	cmd := s.activeCmds[streamerID]
	s.mu.Unlock()

	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		return
	}
	if pid != nil && *pid > 0 {
		_ = syscall.Kill(*pid, syscall.SIGTERM)
	}
}

func resolutionToStreamlinkFormat(res string) string {
	switch res {
	case "144p":
		return "144p,worst"
	case "360p":
		return "360p,worst"
	case "720p":
		return "720p60,720p,best"
	default:
		return "1080p60,1080p,best"
	}
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
