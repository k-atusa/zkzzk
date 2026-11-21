package recordings

import (
	"fmt"
	"io/fs"
	"math"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/k-atusa/zkzzk/backend/auth"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/httpx"
)

var recordingTitleRe = regexp.MustCompile(`(?i)^\d{6}_\d{6} (.+) \[.+\]\.(ts|mp4)$`)

// Item matches each recording entry returned by GET /api/recordings.
type Item struct {
	ID             *string   `json:"id"`
	DisplayName    string    `json:"display_name"`
	Filename       string    `json:"filename"`
	Title          string    `json:"title"`
	CreatedAt      time.Time `json:"created_at"`
	StreamerName   string    `json:"streamer_name"`
	SizeMB         float64   `json:"size_mb"`
	YoutubeStatus  *string   `json:"youtube_status"`
	YoutubeVideoID *string   `json:"youtube_video_id"`
	Resolution     *string   `json:"resolution"`
	IsRecording    bool      `json:"is_recording"`
}

// Service manages listing, downloading, and deleting recorded video files.
type Service struct {
	store *db.Store
	cfg   *config.Config
}

// NewService constructs a Recordings Service.
func NewService(store *db.Store, cfg *config.Config) *Service {
	return &Service{
		store: store,
		cfg:   cfg,
	}
}

func (s *Service) canAccessPath(rel string, user *db.User) (string, bool) {
	if user == nil {
		return "", false
	}
	cleaned := strings.TrimPrefix(path.Clean("/"+strings.ReplaceAll(rel, "\\", "/")), "/")
	if cleaned == "" || cleaned == "." || strings.HasPrefix(cleaned, "..") {
		return "", false
	}
	if !user.IsAdmin && !strings.HasPrefix(cleaned, user.Username+"/") {
		return "", false
	}
	absTarget := filepath.Join(s.cfg.DownloadsDir, filepath.FromSlash(cleaned))
	absBase, err := filepath.Abs(s.cfg.DownloadsDir)
	if err != nil {
		return "", false
	}
	absTarget, err = filepath.Abs(absTarget)
	if err != nil {
		return "", false
	}
	if absTarget != absBase && !strings.HasPrefix(absTarget, absBase+string(filepath.Separator)) {
		return "", false
	}
	return absTarget, true
}

func (s *Service) HandleList(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())

	dbRecordings, err := s.store.ListRecordings(user.ID, user.IsAdmin)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return
	}
	dbMap := make(map[string]db.Recording, len(dbRecordings))
	for _, rec := range dbRecordings {
		dbMap[rec.Filename] = rec
	}

	userDownloadsDir := filepath.Join(s.cfg.DownloadsDir, user.Username)
	grouped := make(map[string][]Item)

	if info, err := os.Stat(userDownloadsDir); err == nil && info.IsDir() {
		_ = filepath.WalkDir(userDownloadsDir, func(fullPath string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return nil
			}
			name := d.Name()
			if !strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".mp4") {
				return nil
			}
			fi, err := d.Info()
			if err != nil {
				return nil
			}

			relToDownloads, err := filepath.Rel(s.cfg.DownloadsDir, fullPath)
			if err != nil {
				return nil
			}
			relToUser, err := filepath.Rel(userDownloadsDir, fullPath)
			if err != nil {
				return nil
			}

			relPath := filepath.ToSlash(relToDownloads)
			dbLookupPath := filepath.ToSlash(relToUser)
			parts := strings.Split(dbLookupPath, "/")

			streamerName := "기타"
			if len(parts) >= 3 {
				category := parts[0]
				streamerFolder := parts[1]
				switch category {
				case "live":
					streamerName = fmt.Sprintf("%s (라이브)", streamerFolder)
				case "vod":
					streamerName = fmt.Sprintf("%s (다시보기)", streamerFolder)
				default:
					streamerName = fmt.Sprintf("%s (%s)", streamerFolder, category)
				}
			} else if len(parts) == 2 {
				if parts[0] == "vod" {
					streamerName = "다시보기 (기존)"
				} else {
					streamerName = parts[0]
				}
			}

			title := name
			if m := recordingTitleRe.FindStringSubmatch(name); len(m) >= 2 {
				title = m[1]
			}

			sizeMB := math.Round((float64(fi.Size())/(1024*1024))*100) / 100

			item := Item{
				DisplayName:  name,
				Filename:     relPath,
				Title:        title,
				CreatedAt:    fi.ModTime(),
				StreamerName: streamerName,
				SizeMB:       sizeMB,
			}
			if dbRec, ok := dbMap[dbLookupPath]; ok {
				idCopy := dbRec.ID
				item.ID = &idCopy
				item.YoutubeStatus = dbRec.YoutubeStatus
				item.YoutubeVideoID = dbRec.YoutubeVideoID
				item.Resolution = dbRec.Resolution
				item.IsRecording = dbRec.IsRecording
			}

			grouped[streamerName] = append(grouped[streamerName], item)
			return nil
		})
	}

	for key := range grouped {
		items := grouped[key]
		sort.Slice(items, func(i, j int) bool {
			return items[i].CreatedAt.After(items[j].CreatedAt)
		})
		grouped[key] = items
	}

	httpx.WriteJSON(w, http.StatusOK, grouped)
}

func (s *Service) HandleDelete(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	var body struct {
		Filename string `json:"filename"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	absPath, ok := s.canAccessPath(body.Filename, user)
	if !ok {
		httpx.WriteError(w, http.StatusForbidden, "권한이 없습니다.")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		httpx.WriteError(w, http.StatusNotFound, "녹화 영상을 찾을 수 없습니다.")
		return
	}

	if err := os.Remove(absPath); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "녹화 영상 삭제에 실패했습니다.")
		return
	}

	userDownloadsDir := filepath.Join(s.cfg.DownloadsDir, user.Username)
	if rel, err := filepath.Rel(userDownloadsDir, absPath); err == nil && !strings.HasPrefix(rel, "..") {
		_ = s.store.DeleteRecordingByUserAndFilename(user.ID, filepath.ToSlash(rel))
	} else if relDownloads, err := filepath.Rel(s.cfg.DownloadsDir, absPath); err == nil {
		// Fallback for admin deleting another user's recording (<owner>/<dbLookupPath>).
		parts := strings.SplitN(filepath.ToSlash(relDownloads), "/", 2)
		if len(parts) == 2 {
			if owner, err := s.store.GetUserByUsername(parts[0]); err == nil && owner != nil {
				_ = s.store.DeleteRecordingByUserAndFilename(owner.ID, parts[1])
			}
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "녹화 영상이 삭제되었습니다.",
	})
}

func (s *Service) HandleDownload(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())

	rawPath := strings.TrimPrefix(r.URL.Path, "/api/recordings/download/")
	if decoded, err := url.PathUnescape(rawPath); err == nil {
		rawPath = decoded
	}
	if rawPath == "" {
		httpx.WriteError(w, http.StatusBadRequest, "Filename is required")
		return
	}

	// Keep compatibility with NestJS check: forbid directory traversal and enforce user prefix.
	norm := strings.ReplaceAll(rawPath, "\\", "/")
	norm = strings.TrimPrefix(norm, "/")
	if strings.Contains(norm, "..") {
		httpx.WriteError(w, http.StatusForbidden, "Forbidden directory traversal")
		return
	}
	if !user.IsAdmin && !strings.HasPrefix(norm, user.Username+"/") {
		httpx.WriteError(w, http.StatusForbidden, "Forbidden")
		return
	}

	absPath, ok := s.canAccessPath(norm, user)
	if !ok {
		httpx.WriteError(w, http.StatusForbidden, "Forbidden")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		httpx.WriteError(w, http.StatusNotFound, "File not found")
		return
	}

	http.ServeFile(w, r, absPath)
}
