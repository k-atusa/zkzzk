package server_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/k-atusa/zkzzk/backend/chzzk"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/events"
	"github.com/k-atusa/zkzzk/backend/httpx"
	"github.com/k-atusa/zkzzk/backend/server"
)

func newIntegrationServer(t *testing.T) (*server.App, *config.Config, func()) {
	t.Helper()
	tmp := t.TempDir()
	cfg := &config.Config{
		Port:         "5001",
		DatabasePath: filepath.Join(tmp, "test.db"),
		DownloadsDir: filepath.Join(tmp, "downloads"),
		JWTSecret:    "integration_secret",
	}
	if err := os.MkdirAll(cfg.DownloadsDir, 0755); err != nil {
		t.Fatal(err)
	}
	store, err := db.Open(cfg.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	staticFS := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<!doctype html><div id='root'></div>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('bundle');")},
	}
	app := server.NewApp(cfg, store, staticFS)
	return app, cfg, func() { _ = store.Close() }
}

func setupAdminCookie(t *testing.T, h http.Handler) []*http.Cookie {
	t.Helper()
	body, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "password123",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("setup failed: %d %s", rr.Code, rr.Body.String())
	}
	return rr.Result().Cookies()
}

func TestSPAAndAPINotFound(t *testing.T) {
	app, _, cleanup := newIntegrationServer(t)
	defer cleanup()

	// Root serves index.html
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "<div id='root'>") {
		t.Fatalf("expected SPA index.html on /, got %d: %s", rr.Code, rr.Body.String())
	}

	// React Router subpath serves index.html
	req = httptest.NewRequest(http.MethodGet, "/settings", nil)
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "<div id='root'>") {
		t.Fatalf("expected SPA index.html on /settings, got %d", rr.Code)
	}

	// Static asset serves asset
	req = httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "bundle") {
		t.Fatalf("expected asset on /assets/app.js, got %d", rr.Code)
	}

	// Unknown API route returns JSON 404, NOT index.html
	req = httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil)
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on unknown api route, got %d", rr.Code)
	}
}

func TestRecordingsListingDownloadRangeAndSecurity(t *testing.T) {
	app, cfg, cleanup := newIntegrationServer(t)
	defer cleanup()

	cookies := setupAdminCookie(t, app.Handler)

	// Create sample recording file under downloads/admin/live/StreamerA/
	dir := filepath.Join(cfg.DownloadsDir, "admin", "live", "StreamerA")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	sampleFile := filepath.Join(dir, "260726_162140 Test Stream [StreamerA].mp4")
	if err := os.WriteFile(sampleFile, []byte("0123456789abcdef"), 0644); err != nil {
		t.Fatal(err)
	}

	// List recordings
	req := httptest.NewRequest(http.MethodGet, "/api/recordings", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr := httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list recordings failed: %d", rr.Code)
	}
	var grouped map[string][]map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &grouped); err != nil {
		t.Fatal(err)
	}
	items := grouped["StreamerA (라이브)"]
	if len(items) != 1 || items[0]["title"] != "Test Stream" {
		t.Fatalf("unexpected recordings response: %+v", grouped)
	}

	// Range download request works
	dlPath := "/api/recordings/download/admin/live/StreamerA/260726_162140%20Test%20Stream%20%5BStreamerA%5D.mp4"
	req = httptest.NewRequest(http.MethodGet, dlPath, nil)
	req.Header.Set("Range", "bytes=0-3")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusPartialContent || rr.Body.String() != "0123" {
		t.Fatalf("expected 206 Partial Content '0123', got %d %q", rr.Code, rr.Body.String())
	}

	// Directory traversal blocked (URL-encoded traversal reaches handler -> 403; literal .. is cleaned by ServeMux -> 307/404)
	req = httptest.NewRequest(http.MethodGet, "/api/recordings/download/%2e%2e/test.db", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on encoded path traversal, got %d", rr.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/recordings/download/admin/%2e%2e/%2e%2e/test.db", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on nested encoded path traversal, got %d", rr.Code)
	}

	// Non-admin user cannot access admin's recording
	createBody, _ := json.Marshal(map[string]any{"username": "member", "password": "memberpass", "is_admin": false})
	req = httptest.NewRequest(http.MethodPost, "/api/auth/users", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create user failed: %d %s", rr.Code, rr.Body.String())
	}

	loginBody, _ := json.Marshal(map[string]string{"username": "member", "password": "memberpass"})
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("member login failed: %d", rr.Code)
	}
	memberCookies := rr.Result().Cookies()

	req = httptest.NewRequest(http.MethodGet, dlPath, nil)
	for _, c := range memberCookies {
		req.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin accessing admin recording, got %d", rr.Code)
	}

	// Admin deletes recording
	delBody, _ := json.Marshal(map[string]string{"filename": "admin/live/StreamerA/260726_162140 Test Stream [StreamerA].mp4"})
	req = httptest.NewRequest(http.MethodPost, "/api/recordings/delete", bytes.NewReader(delBody))
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	app.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete recording failed: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(sampleFile); !os.IsNotExist(err) {
		t.Fatalf("expected file to be deleted")
	}
}

func TestSSEEvents(t *testing.T) {
	app, _, cleanup := newIntegrationServer(t)
	defer cleanup()

	ts := httptest.NewServer(app.Handler)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/events/vod", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("SSE connect failed: %v", err)
	}
	defer resp.Body.Close()

	go func() {
		time.Sleep(50 * time.Millisecond)
		app.Events.EmitVodProgress(events.VodProgressPayload{
			RecordingID: "rec-1",
			Progress:    "완료",
		})
	}()

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			if !strings.Contains(line, "VOD_DOWNLOAD_PROGRESS") || !strings.Contains(line, "rec-1") {
				t.Fatalf("unexpected SSE payload: %s", line)
			}
			return
		}
	}
	t.Fatalf("did not receive expected SSE event")
}

func TestHelpers(t *testing.T) {
	if id := chzzk.ExtractChannelID("https://chzzk.naver.com/0123456789abcdef0123456789abcdef"); id != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("unexpected channel id: %s", id)
	}
	if vno := chzzk.ExtractVideoNo("https://chzzk.naver.com/video/13780464"); vno != "13780464" {
		t.Fatalf("unexpected video no: %s", vno)
	}
	if res, ok := httpx.ParseStreamlinkResolution("[cli][info] Opening stream: 1080p60 (hls)"); !ok || res != "1080p" {
		t.Fatalf("unexpected parsed resolution: %s %v", res, ok)
	}
	if res, ok := httpx.ParseStreamlinkResolution("Opening stream: 1920x1080"); !ok || res != "1080p" {
		t.Fatalf("unexpected parsed dimension resolution: %s %v", res, ok)
	}
}
