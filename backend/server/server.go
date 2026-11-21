package server

import (
	"context"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/k-atusa/zkzzk/backend/auth"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/events"
	"github.com/k-atusa/zkzzk/backend/httpx"
	"github.com/k-atusa/zkzzk/backend/recordings"
	"github.com/k-atusa/zkzzk/backend/streamers"
	"github.com/k-atusa/zkzzk/backend/tasks"
	"github.com/k-atusa/zkzzk/backend/vod"
	"github.com/k-atusa/zkzzk/backend/youtube"
)

// App bundles all initialized backend services and the HTTP router.
type App struct {
	Config     *config.Config
	Store      *db.Store
	Auth       *auth.Service
	Events     *events.Broker
	Youtube    *youtube.Service
	Tasks      *tasks.Service
	Streamers  *streamers.Service
	Recordings *recordings.Service
	Vod        *vod.Service
	Handler    http.Handler
}

// NewApp constructs all backend services and wires the HTTP handler with embedded frontend assets.
func NewApp(cfg *config.Config, store *db.Store, staticFS fs.FS) *App {
	authSvc := auth.NewService(store, cfg.JWTSecret)
	evBroker := events.NewBroker()
	ytSvc := youtube.NewService(store, cfg, evBroker)
	tasksSvc := tasks.NewService(store, cfg, ytSvc)
	streamersSvc := streamers.NewService(store, tasksSvc)
	recordingsSvc := recordings.NewService(store, cfg)
	vodSvc := vod.NewService(store, cfg, evBroker)

	mux := http.NewServeMux()

	// Auth routes
	mux.HandleFunc("GET /api/auth/status", authSvc.HandleStatus)
	mux.HandleFunc("POST /api/auth/setup", authSvc.HandleSetup)
	mux.HandleFunc("POST /api/auth/login", authSvc.HandleLogin)
	mux.HandleFunc("POST /api/auth/logout", authSvc.HandleLogout)
	mux.HandleFunc("GET /api/auth/me", authSvc.RequireAuth(authSvc.HandleMe))
	mux.HandleFunc("POST /api/auth/change-password", authSvc.RequireAuth(authSvc.HandleChangePassword))
	mux.HandleFunc("GET /api/auth/users", authSvc.RequireAuth(authSvc.HandleListUsers))
	mux.HandleFunc("POST /api/auth/users", authSvc.RequireAuth(authSvc.HandleCreateUser))
	mux.HandleFunc("DELETE /api/auth/users/{id}", authSvc.RequireAuth(authSvc.HandleDeleteUser))
	mux.HandleFunc("POST /api/auth/verify-cookies", authSvc.RequireAuth(authSvc.HandleVerifyCookies))
	mux.HandleFunc("POST /api/auth/2fa/setup", authSvc.RequireAuth(authSvc.Handle2FASetup))
	mux.HandleFunc("POST /api/auth/2fa/verify", authSvc.RequireAuth(authSvc.Handle2FAVerify))
	mux.HandleFunc("POST /api/auth/2fa/disable", authSvc.RequireAuth(authSvc.Handle2FADisable))
	mux.HandleFunc("GET /api/auth/user-settings", authSvc.RequireAuth(authSvc.HandleGetUserSettings))
	mux.HandleFunc("POST /api/auth/user-settings", authSvc.RequireAuth(authSvc.HandleUpdateUserSettings))

	// Streamers routes
	mux.HandleFunc("GET /api/streamers", authSvc.RequireAuth(streamersSvc.HandleList))
	mux.HandleFunc("GET /api/streamers/following", authSvc.RequireAuth(streamersSvc.HandleFollowing))
	mux.HandleFunc("POST /api/streamers/add_streamer", authSvc.RequireAuth(streamersSvc.HandleAdd))
	mux.HandleFunc("POST /api/streamers/remove_streamer/{id}", authSvc.RequireAuth(streamersSvc.HandleRemove))
	mux.HandleFunc("POST /api/streamers/stop_recording/{id}", authSvc.RequireAuth(streamersSvc.HandleStopRecording))
	mux.HandleFunc("POST /api/streamers/resume_recording/{id}", authSvc.RequireAuth(streamersSvc.HandleResumeRecording))
	mux.HandleFunc("POST /api/streamers/set_streamer_cookies", authSvc.RequireAuth(streamersSvc.HandleSetCookies))

	// Recordings routes
	mux.HandleFunc("GET /api/recordings", authSvc.RequireAuth(recordingsSvc.HandleList))
	mux.HandleFunc("POST /api/recordings/delete", authSvc.RequireAuth(recordingsSvc.HandleDelete))
	mux.HandleFunc("GET /api/recordings/download/{path...}", authSvc.RequireAuth(recordingsSvc.HandleDownload))

	// VOD routes
	mux.HandleFunc("POST /api/vod/get_vod_info", authSvc.RequireAuth(vodSvc.HandleGetVodInfo))
	mux.HandleFunc("POST /api/vod/download_vod", authSvc.RequireAuth(vodSvc.HandleDownloadVod))

	// YouTube routes
	mux.HandleFunc("GET /api/youtube/auth-url", authSvc.RequireAuth(ytSvc.HandleAuthUrl))
	mux.HandleFunc("GET /api/youtube/callback", ytSvc.HandleCallback)
	mux.HandleFunc("POST /api/youtube/upload", authSvc.RequireAuth(ytSvc.HandleUpload))

	// SSE Events routes
	mux.HandleFunc("GET /api/events/youtube", evBroker.HandleYoutubeSSE)
	mux.HandleFunc("GET /api/events/vod", evBroker.HandleVodSSE)

	// Catch-all for unknown /api routes so they don't fall back to SPA index.html
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, http.StatusNotFound, "Not Found")
	})

	// Embedded frontend static assets + SPA fallback
	mux.Handle("/", newSPAHandler(staticFS))

	return &App{
		Config:     cfg,
		Store:      store,
		Auth:       authSvc,
		Events:     evBroker,
		Youtube:    ytSvc,
		Tasks:      tasksSvc,
		Streamers:  streamersSvc,
		Recordings: recordingsSvc,
		Vod:        vodSvc,
		Handler:    corsMiddleware(mux),
	}
}

// StartBackgroundTasks begins the live stream polling loop and startup orphan cleanup.
func (a *App) StartBackgroundTasks(ctx context.Context) {
	a.Tasks.Start(ctx)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func newSPAHandler(staticFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(staticFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if staticFS == nil {
			httpx.WriteError(w, http.StatusNotFound, "Frontend assets not embedded")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "Method Not Allowed")
			return
		}

		cleanPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if cleanPath != "" && cleanPath != "." {
			if f, err := staticFS.Open(cleanPath); err == nil {
				info, statErr := f.Stat()
				_ = f.Close()
				if statErr == nil && !info.IsDir() {
					fileServer.ServeHTTP(w, r)
					return
				}
			}
		}

		indexBytes, err := fs.ReadFile(staticFS, "index.html")
		if err != nil {
			httpx.WriteError(w, http.StatusNotFound, "index.html not found")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write(indexBytes)
		}
	})
}
