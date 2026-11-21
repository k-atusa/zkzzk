package vod

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/k-atusa/zkzzk/backend/auth"
	"github.com/k-atusa/zkzzk/backend/chzzk"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/events"
	"github.com/k-atusa/zkzzk/backend/httpx"
)

var downloadProgressRe = regexp.MustCompile(`(?i)\[download\]\s+(Written.+)`)

// Service handles VOD metadata queries and background streamlink + ffmpeg downloads.
type Service struct {
	store  *db.Store
	cfg    *config.Config
	events *events.Broker
}

// NewService constructs a VOD Service.
func NewService(store *db.Store, cfg *config.Config, ev *events.Broker) *Service {
	return &Service{
		store:  store,
		cfg:    cfg,
		events: ev,
	}
}

func (s *Service) HandleGetVodInfo(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	var body struct {
		VodURL string `json:"vod_url"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	videoNo := chzzk.ExtractVideoNo(body.VodURL)
	if videoNo == "" {
		httpx.WriteError(w, http.StatusBadRequest, "올바른 치지직 VOD URL이 아닙니다.")
		return
	}

	var nidAut, nidSes string
	if user.NidAut != nil && user.NidSes != nil {
		nidAut = *user.NidAut
		nidSes = *user.NidSes
	}

	info, err := chzzk.GetVodInfo(videoNo, nidAut, nidSes)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, info)
}

func (s *Service) HandleDownloadVod(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	var body struct {
		DownloadURL string `json:"download_url"`
		VideoInfo   struct {
			Title          string `json:"title"`
			Author         string `json:"author"`
			RawPublishDate string `json:"raw_publish_date"`
		} `json:"video_info"`
		Resolution struct {
			DownloadType string `json:"download_type"`
		} `json:"resolution"`
		Overwrite bool `json:"overwrite"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.DownloadURL == "" {
		httpx.WriteError(w, http.StatusBadRequest, "다운로드 URL이 필요합니다.")
		return
	}

	streamerNickname := httpx.SanitizeFilename(body.VideoInfo.Author)
	if streamerNickname == "" {
		streamerNickname = "Unknown"
	}
	cleanTitle := httpx.SanitizeFilename(body.VideoInfo.Title)
	if cleanTitle == "" {
		cleanTitle = "Unknown"
	}

	pubTime := parsePublishDate(body.VideoInfo.RawPublishDate)
	datePrefix := pubTime.Format("060102_150405")
	filename := fmt.Sprintf("%s %s [%s].mp4", datePrefix, cleanTitle, streamerNickname)

	vodDir := filepath.Join(s.cfg.DownloadsDir, user.Username, "vod", streamerNickname)
	if err := os.MkdirAll(vodDir, 0755); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "디렉토리 생성에 실패했습니다.")
		return
	}

	mp4Path := filepath.Join(vodDir, filename)
	tsPath := strings.TrimSuffix(mp4Path, ".mp4") + ".ts"
	if _, err := os.Stat(mp4Path); err == nil {
		if !body.Overwrite {
			httpx.WriteError(w, http.StatusBadRequest, "FILE_EXISTS")
			return
		}
		_ = os.Remove(mp4Path)
		_ = os.Remove(tsPath)
	}

	formatString := vodResolutionFormat(user.VodResolution)
	dbTSFilename := filepath.ToSlash(filepath.Join("vod", streamerNickname, strings.TrimSuffix(filename, ".mp4")+".ts"))
	rec, err := s.store.CreateRecording(nil, user.ID, dbTSFilename, cleanTitle, true)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "데이터베이스 기록에 실패했습니다.")
		return
	}

	go s.runDownload(rec.ID, body.DownloadURL, formatString, tsPath, mp4Path, streamerNickname, filename)

	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"status":   "success",
		"message":  "서버 다운로드가 시작되었습니다.",
		"filename": filename,
	})
}

func (s *Service) runDownload(recordingID, downloadURL, formatString, tsPath, mp4Path, streamerNickname, mp4Filename string) {
	streamlinkCmd := config.FindExecutable("streamlink")
	cmd := exec.Command(streamlinkCmd,
		"--http-header", "User-Agent=Mozilla/5.0",
		downloadURL,
		formatString,
		"--output", tsPath,
	)

	stdoutPipe, err1 := cmd.StdoutPipe()
	stderrPipe, err2 := cmd.StderrPipe()
	if err1 != nil || err2 != nil {
		log.Printf("[VodService] Failed to create pipes for VOD download")
		s.events.EmitVodProgress(events.VodProgressPayload{RecordingID: recordingID, Progress: "다운로드 실패"})
		_ = s.store.UpdateRecordingIsRecording(recordingID, false)
		return
	}

	if err := cmd.Start(); err != nil {
		log.Printf("[VodService] Failed to start download process for VOD: %v", err)
		s.events.EmitVodProgress(events.VodProgressPayload{RecordingID: recordingID, Progress: "다운로드 실패"})
		_ = s.store.UpdateRecordingIsRecording(recordingID, false)
		return
	}

	var resOnce sync.Once
	var wg sync.WaitGroup
	scanPipe := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		scanner.Split(splitCRorLF)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			if m := downloadProgressRe.FindStringSubmatch(line); len(m) >= 2 {
				s.events.EmitVodProgress(events.VodProgressPayload{
					RecordingID: recordingID,
					Progress:    "다운로드 중: " + m[1],
				})
			}
			if resStr, ok := httpx.ParseStreamlinkResolution(line); ok {
				resOnce.Do(func() {
					_ = s.store.UpdateRecordingResolution(recordingID, resStr)
				})
			}
		}
	}

	wg.Add(2)
	go scanPipe(stdoutPipe)
	go scanPipe(stderrPipe)
	wg.Wait()

	waitErr := cmd.Wait()
	if waitErr != nil {
		exitCode := -1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
		log.Printf("[VodService] Download process exited with code %d", exitCode)
		s.events.EmitVodProgress(events.VodProgressPayload{RecordingID: recordingID, Progress: "다운로드 실패 (오류 발생)"})
		_ = s.store.UpdateRecordingIsRecording(recordingID, false)
		return
	}

	s.events.EmitVodProgress(events.VodProgressPayload{RecordingID: recordingID, Progress: "MP4 포맷으로 변환 중..."})

	ffmpegCmd := config.FindExecutable("ffmpeg")
	ff := exec.Command(ffmpegCmd, "-i", tsPath, "-c", "copy", "-y", mp4Path)
	ffErr := ff.Run()
	_ = os.Remove(tsPath)

	if ffErr != nil {
		log.Printf("[VodService] ffmpeg failed for VOD: %v", ffErr)
		s.events.EmitVodProgress(events.VodProgressPayload{RecordingID: recordingID, Progress: "변환 실패"})
		_ = s.store.UpdateRecordingIsRecording(recordingID, false)
		return
	}

	relMP4 := filepath.ToSlash(filepath.Join("vod", streamerNickname, mp4Filename))
	_ = s.store.UpdateRecordingFilenameAndDone(recordingID, relMP4)
	s.events.EmitVodProgress(events.VodProgressPayload{RecordingID: recordingID, Progress: "완료"})
}

func vodResolutionFormat(res string) string {
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

func parsePublishDate(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Now()
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
	} {
		if t, err := time.ParseInLocation(layout, raw, time.Local); err == nil {
			return t
		}
	}
	return time.Now()
}

func splitCRorLF(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
		return i + 1, data[0:i], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}
