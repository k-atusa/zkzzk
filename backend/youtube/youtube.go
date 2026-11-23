package youtube

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/k-atusa/zkzzk/backend/auth"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/events"
	"github.com/k-atusa/zkzzk/backend/httpx"
	"github.com/k-atusa/zkzzk/backend/notify"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
	ytapi "google.golang.org/api/youtube/v3"
)

var (
	videoExtRe = regexp.MustCompile(`(?i)\.(mp4|ts|mkv|avi)$`)
	digitsRe   = regexp.MustCompile(`^\d+$`)
)

// Service manages YouTube OAuth2 linking, duplicate checking, and video uploads.
type Service struct {
	store  *db.Store
	cfg    *config.Config
	events *events.Broker

	locksMu     sync.Mutex
	uploadLocks map[string]struct{}
}

// NewService constructs a YouTube Service.
func NewService(store *db.Store, cfg *config.Config, ev *events.Broker) *Service {
	return &Service{
		store:       store,
		cfg:         cfg,
		events:      ev,
		uploadLocks: make(map[string]struct{}),
	}
}

type oauthState struct {
	UserID      string `json:"userId"`
	FrontendURL string `json:"frontendUrl"`
}

// savingTokenSource persists refreshed RefreshTokens back to SQLite if Google rotates them.
type savingTokenSource struct {
	base   oauth2.TokenSource
	store  *db.Store
	userID string
	mu     sync.Mutex
	lastRT string
}

func (s *savingTokenSource) Token() (*oauth2.Token, error) {
	tok, err := s.base.Token()
	if err != nil {
		return nil, err
	}
	if tok.RefreshToken != "" {
		s.mu.Lock()
		changed := tok.RefreshToken != s.lastRT
		if changed {
			s.lastRT = tok.RefreshToken
		}
		s.mu.Unlock()
		if changed {
			_ = s.store.UpdateUserSettings(s.userID, map[string]any{
				"youtube_refresh_token": tok.RefreshToken,
			})
		}
	}
	return tok, nil
}

func (s *Service) oauthConfigForUser(user *db.User, origin string) (*oauth2.Config, error) {
	if user == nil || user.YoutubeClientID == nil || *user.YoutubeClientID == "" ||
		user.YoutubeClientSecret == nil || *user.YoutubeClientSecret == "" {
		return nil, errors.New("YouTube API is not configured for this user")
	}

	var redirectURI string
	if origin != "" {
		redirectURI = strings.TrimRight(origin, "/") + "/api/youtube/callback"
	} else if user.YoutubeRedirectURI != nil && *user.YoutubeRedirectURI != "" {
		redirectURI = *user.YoutubeRedirectURI
	} else {
		redirectURI = fmt.Sprintf("http://localhost:%s/api/youtube/callback", s.cfg.Port)
	}

	return &oauth2.Config{
		ClientID:     *user.YoutubeClientID,
		ClientSecret: *user.YoutubeClientSecret,
		RedirectURL:  redirectURI,
		Scopes: []string{
			ytapi.YoutubeUploadScope,
			ytapi.YoutubeReadonlyScope,
		},
		Endpoint: google.Endpoint,
	}, nil
}

func (s *Service) getYoutubeClient(ctx context.Context, userID string) (*ytapi.Service, error) {
	user, err := s.store.GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	oauthCfg, err := s.oauthConfigForUser(user, "")
	if err != nil {
		return nil, err
	}
	if user.YoutubeRefreshToken == nil || *user.YoutubeRefreshToken == "" {
		return nil, errors.New("YouTube account is not authenticated")
	}

	seed := &oauth2.Token{RefreshToken: *user.YoutubeRefreshToken}
	ts := &savingTokenSource{
		base:   oauthCfg.TokenSource(ctx, seed),
		store:  s.store,
		userID: userID,
		lastRT: *user.YoutubeRefreshToken,
	}
	return ytapi.NewService(ctx, option.WithTokenSource(ts))
}

// HandleAuthUrl handles GET /api/youtube/auth-url.
func (s *Service) HandleAuthUrl(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	origin := httpx.RequestOrigin(r)

	frontendURL := s.cfg.FrontendURL
	if frontendURL == "" {
		if ref := r.Header.Get("Referer"); ref != "" {
			if u, err := url.Parse(ref); err == nil && u.Scheme != "" && u.Host != "" {
				frontendURL = u.Scheme + "://" + u.Host
			}
		} else if origHdr := r.Header.Get("Origin"); origHdr != "" {
			if u, err := url.Parse(origHdr); err == nil && u.Scheme != "" && u.Host != "" {
				frontendURL = u.Scheme + "://" + u.Host
			}
		}
	}

	oauthCfg, err := s.oauthConfigForUser(user, origin)
	if err != nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"error": err.Error()})
		return
	}

	stateBytes, _ := json.Marshal(oauthState{UserID: user.ID, FrontendURL: frontendURL})
	state := base64.RawURLEncoding.EncodeToString(stateBytes)

	authURL := oauthCfg.AuthCodeURL(
		state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("prompt", "consent"),
	)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"url": authURL})
}

// HandleCallback handles GET /api/youtube/callback.
func (s *Service) HandleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	rawState := r.URL.Query().Get("state")

	userID := rawState
	frontendURL := s.cfg.FrontendURL

	if rawState != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(rawState)
		if err != nil {
			decoded, err = base64.URLEncoding.DecodeString(rawState)
		}
		if err == nil {
			var st oauthState
			if err := json.Unmarshal(decoded, &st); err == nil {
				if st.UserID != "" {
					userID = st.UserID
				}
				if st.FrontendURL != "" {
					frontendURL = st.FrontendURL
				}
			}
		}
	}

	if code == "" || userID == "" {
		http.Redirect(w, r, frontendURL+"/settings?youtube=error", http.StatusFound)
		return
	}

	origin := httpx.RequestOrigin(r)
	channelName, err := s.setCredentials(r.Context(), code, userID, origin)
	if err != nil || channelName == "" {
		if err != nil {
			log.Printf("[YoutubeService] OAuth callback failed: %v", err)
		}
		http.Redirect(w, r, frontendURL+"/settings?youtube=error", http.StatusFound)
		return
	}

	http.Redirect(w, r, frontendURL+"/settings?youtube=success&channelName="+url.QueryEscape(channelName), http.StatusFound)
}

func (s *Service) setCredentials(ctx context.Context, code, userID, origin string) (string, error) {
	user, err := s.store.GetUserByID(userID)
	if err != nil {
		return "", err
	}
	oauthCfg, err := s.oauthConfigForUser(user, origin)
	if err != nil {
		return "", err
	}

	tok, err := oauthCfg.Exchange(ctx, code)
	if err != nil {
		return "", err
	}

	updates := map[string]any{
		"youtube_redirect_uri": strings.TrimRight(origin, "/") + "/api/youtube/callback",
	}
	if tok.RefreshToken != "" {
		updates["youtube_refresh_token"] = tok.RefreshToken
	} else if user.YoutubeRefreshToken == nil || *user.YoutubeRefreshToken == "" {
		log.Printf("[YoutubeService] Warning: no refresh token received and none stored in database for user %s", userID)
	}
	if err := s.store.UpdateUserSettings(userID, updates); err != nil {
		return "", err
	}

	channelName := "인증된 채널"
	yt, err := ytapi.NewService(ctx, option.WithTokenSource(oauthCfg.TokenSource(ctx, tok)))
	if err == nil {
		resp, err := yt.Channels.List([]string{"snippet"}).Mine(true).Do()
		if err == nil && len(resp.Items) > 0 && resp.Items[0].Snippet != nil && resp.Items[0].Snippet.Title != "" {
			channelName = resp.Items[0].Snippet.Title
		} else if err != nil {
			log.Printf("[YoutubeService] Failed to fetch YouTube channel info: %v", err)
		}
	}

	_ = s.store.UpdateUserSettings(userID, map[string]any{
		"youtube_channel_title": channelName,
	})
	return channelName, nil
}

// AcquireLock attempts to take an exclusive upload lock for the given file path.
func (s *Service) AcquireLock(key string) bool {
	norm := filepath.ToSlash(filepath.Clean(key))
	s.locksMu.Lock()
	defer s.locksMu.Unlock()
	if _, exists := s.uploadLocks[norm]; exists {
		return false
	}
	s.uploadLocks[norm] = struct{}{}
	return true
}

// ReleaseLock releases an upload lock for the given file path.
func (s *Service) ReleaseLock(key string) {
	norm := filepath.ToSlash(filepath.Clean(key))
	s.locksMu.Lock()
	delete(s.uploadLocks, norm)
	s.locksMu.Unlock()
}

func computeFileHash(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// CheckDuplicateVideo checks DB hash and YouTube search API to avoid duplicate uploads.
func (s *Service) CheckDuplicateVideo(ctx context.Context, userID, title, filePath string) (bool, string) {
	var fileHash string
	if filePath != "" {
		if _, err := os.Stat(filePath); err == nil {
			if h, err := computeFileHash(filePath); err == nil {
				fileHash = h
				if dup, err := s.store.FindDuplicateRecordingByHash(userID, fileHash); err == nil && dup != nil {
					log.Printf("[YoutubeService] Duplicate found in database by hash: %s", fileHash)
					return true, fileHash
				}
			} else {
				log.Printf("[YoutubeService] Failed to calculate file hash: %v", err)
			}
		}
	}

	yt, err := s.getYoutubeClient(ctx, userID)
	if err != nil {
		log.Printf("[YoutubeService] Failed to check duplicate video (auth): %v", err)
		return false, fileHash
	}

	cleanTitle := videoExtRe.ReplaceAllString(title, "")

	titleRes, err := yt.Search.List([]string{"snippet"}).ForMine(true).Type("video").Q(cleanTitle).MaxResults(5).Do()
	if err != nil {
		log.Printf("[YoutubeService] Failed to check duplicate video by title: %v", err)
		return false, fileHash
	}
	for _, item := range titleRes.Items {
		if item.Snippet != nil && item.Snippet.Title == cleanTitle {
			log.Printf("[YoutubeService] Duplicate found by title on YouTube: %s", cleanTitle)
			return true, fileHash
		}
	}

	if fileHash != "" {
		hashRes, err := yt.Search.List([]string{"snippet"}).ForMine(true).Type("video").Q(fileHash).MaxResults(5).Do()
		if err != nil {
			log.Printf("[YoutubeService] Failed to check duplicate video by hash: %v", err)
			return false, fileHash
		}
		marker := fmt.Sprintf("[FileHash: %s]", fileHash)
		for _, item := range hashRes.Items {
			if item.Snippet != nil && strings.Contains(item.Snippet.Description, marker) {
				log.Printf("[YoutubeService] Duplicate found by hash on YouTube: %s", fileHash)
				return true, fileHash
			}
		}
	}

	return false, fileHash
}

// UploadVideo uploads a video file to YouTube, updating DB status, Discord notifications, and SSE events.
func (s *Service) UploadVideo(
	recordingID string,
	filePath string,
	title string,
	description string,
	category string,
	tags []string,
	userID string,
	precalculatedHash string,
) {
	defer s.ReleaseLock(filePath)

	cleanTitle := videoExtRe.ReplaceAllString(title, "")
	finalUserID := userID

	if recordingID != "" {
		if rec, err := s.store.GetRecordingByID(recordingID); err == nil && rec != nil && rec.UserID != nil && *rec.UserID != "" {
			finalUserID = *rec.UserID
		}
	}

	failUpload := func(err error) {
		log.Printf("[YoutubeService] Upload failed for %s: %v", cleanTitle, err)
		if recordingID != "" {
			_ = s.store.UpdateRecordingYoutubeStatus(recordingID, "FAILED", nil, nil)
		}
		if finalUserID != "" {
			notify.SendDiscordWebhook(s.store, finalUserID, notify.Embed{
				Title:       "❌ 유튜브 업로드 실패",
				Description: fmt.Sprintf("**제목:** %s\n영상의 유튜브 업로드가 실패했습니다.\n\n**오류**: %s", cleanTitle, err.Error()),
				Color:       0xFF0000,
			})
		}
	}

	if finalUserID == "" {
		failUpload(errors.New("User ID is required for YouTube upload"))
		return
	}

	fileHash := precalculatedHash
	if fileHash == "" {
		if h, err := computeFileHash(filePath); err == nil {
			fileHash = h
		} else {
			log.Printf("[YoutubeService] Could not calculate hash for upload: %v", err)
		}
	}

	if recordingID != "" {
		var hashPtr *string
		if fileHash != "" {
			hashPtr = &fileHash
		}
		_ = s.store.UpdateRecordingYoutubeStatus(recordingID, "UPLOADING", nil, hashPtr)
	}

	notify.SendDiscordWebhook(s.store, finalUserID, notify.Embed{
		Title:       "📤 유튜브 업로드 시작",
		Description: fmt.Sprintf("**제목:** %s\n영상의 유튜브 업로드를 시작합니다.", cleanTitle),
		Color:       0x9B59B6,
	})

	ctx := context.Background()
	yt, err := s.getYoutubeClient(ctx, finalUserID)
	if err != nil {
		failUpload(err)
		return
	}

	stat, err := os.Stat(filePath)
	if err != nil {
		failUpload(err)
		return
	}
	fileSize := stat.Size()

	f, err := os.Open(filePath)
	if err != nil {
		failUpload(err)
		return
	}
	defer f.Close()

	finalDesc := description
	if fileHash != "" {
		finalDesc += fmt.Sprintf("\n\n[FileHash: %s]", fileHash)
	}

	finalTags := make([]string, 0, len(tags)+1)
	finalTags = append(finalTags, tags...)
	finalCat := category
	if finalCat == "" {
		finalCat = "20"
	}
	if !digitsRe.MatchString(finalCat) {
		if finalCat != "20" {
			found := false
			for _, t := range finalTags {
				if t == finalCat {
					found = true
					break
				}
			}
			if !found {
				finalTags = append(finalTags, finalCat)
			}
		}
		finalCat = "20"
	}

	video := &ytapi.Video{
		Snippet: &ytapi.VideoSnippet{
			Title:       cleanTitle,
			Description: finalDesc,
			CategoryId:  finalCat,
			Tags:        finalTags,
		},
		Status: &ytapi.VideoStatus{
			PrivacyStatus: "unlisted",
		},
	}

	lastLoggedPct := -10
	call := yt.Videos.Insert([]string{"snippet", "status"}, video)
	call.Media(f, googleapi.ContentType("application/octet-stream"))
	call.ProgressUpdater(func(current, _ int64) {
		if fileSize > 0 {
			pct := int((float64(current) / float64(fileSize)) * 100)
			if pct >= lastLoggedPct+5 || pct == 100 {
				lastLoggedPct = pct
				log.Printf("[YoutubeService] Uploading %s - %d%%", cleanTitle, pct)
			}
		}
	})

	res, err := call.Do()
	_ = f.Close()
	if err != nil {
		failUpload(err)
		return
	}

	if res != nil && res.Id != "" {
		videoID := res.Id
		if recordingID != "" {
			_ = s.store.UpdateRecordingYoutubeStatus(recordingID, "UPLOADED", &videoID, nil)
		}
		log.Printf("[YoutubeService] Upload completed for %s", cleanTitle)
		notify.SendDiscordWebhook(s.store, finalUserID, notify.Embed{
			Title:       "✅ 유튜브 업로드 완료",
			Description: fmt.Sprintf("**제목:** %s\n영상이 유튜브에 성공적으로 업로드되었습니다.\n\n**비디오 링크**: [youtu.be/%s](https://youtu.be/%s)", cleanTitle, videoID, videoID),
			Color:       0x2ECC71,
		})

		uploadUser, err := s.store.GetUserByID(finalUserID)
		if err == nil && uploadUser != nil && uploadUser.DeleteAfterUpload {
			if _, statErr := os.Stat(filePath); statErr == nil {
				if rmErr := os.Remove(filePath); rmErr != nil {
					log.Printf("[YoutubeService] Failed to delete local file after upload: %v", rmErr)
				} else {
					log.Printf("[YoutubeService] Deleted local file after upload: %s", filePath)
				}
			}
			if recordingID != "" {
				if delErr := s.store.DeleteRecordingByID(recordingID); delErr != nil {
					log.Printf("[YoutubeService] Failed to delete recording from database: %v", delErr)
				} else {
					log.Printf("[YoutubeService] Deleted recording from database: %s", recordingID)
					s.events.EmitYoutubeUploadComplete(events.YoutubeUploadPayload{
						RecordingID: recordingID,
						VideoID:     videoID,
						IsDeleted:   true,
					})
				}
			}
		} else if recordingID != "" {
			s.events.EmitYoutubeUploadComplete(events.YoutubeUploadPayload{
				RecordingID: recordingID,
				VideoID:     videoID,
				IsDeleted:   false,
			})
		}
	}
}

// HandleUpload handles POST /api/youtube/upload.
func (s *Service) HandleUpload(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	var body struct {
		RecordingID string `json:"recordingId"`
		FilePath    string `json:"filePath"`
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.RecordingID != "" {
		rec, err := s.store.GetRecordingByID(body.RecordingID)
		if err == nil && rec != nil && rec.YoutubeStatus != nil && *rec.YoutubeStatus == "UPLOADED" && rec.YoutubeVideoID != nil && *rec.YoutubeVideoID != "" {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"success":          true,
				"already_uploaded": true,
				"video_id":         *rec.YoutubeVideoID,
				"message":          "Already uploaded",
			})
			return
		}
	}

	cleanRel := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(body.FilePath)), "/")
	if cleanRel == "" || strings.HasPrefix(cleanRel, "../") || strings.Contains(cleanRel, "/../") {
		httpx.WriteError(w, http.StatusForbidden, "Forbidden path")
		return
	}
	if !user.IsAdmin && !strings.HasPrefix(cleanRel, user.Username+"/") {
		httpx.WriteError(w, http.StatusForbidden, "Forbidden")
		return
	}

	absPath := filepath.Join(s.cfg.DownloadsDir, filepath.FromSlash(cleanRel))
	if !s.AcquireLock(absPath) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"success": false,
			"message": "이 파일에 대해 이미 다른 업로드 작업이 진행 중입니다.",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	isDup, fileHash := s.CheckDuplicateVideo(ctx, user.ID, body.Title, absPath)
	if isDup {
		s.ReleaseLock(absPath)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"success":          true,
			"already_uploaded": true,
			"video_id":         "",
			"message":          "이미 유튜브 채널에 업로드된 영상입니다.",
		})
		return
	}

	go s.UploadVideo(body.RecordingID, absPath, body.Title, body.Description, "20", nil, user.ID, fileHash)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Upload started",
	})
}
