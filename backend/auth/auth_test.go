package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/k-atusa/zkzzk/backend/auth"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/server"
	"github.com/pquerna/otp/totp"
	"testing/fstest"
	"time"
)

func newTestApp(t *testing.T) (*server.App, func()) {
	t.Helper()
	tmp := t.TempDir()
	cfg := &config.Config{
		Port:         "5001",
		DatabasePath: filepath.Join(tmp, "test.db"),
		DownloadsDir: filepath.Join(tmp, "downloads"),
		JWTSecret:    "test_jwt_secret",
	}
	store, err := db.Open(cfg.DatabasePath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	staticFS := fstest.MapFS{
		"index.html":      &fstest.MapFile{Data: []byte("<html><body>ZKZZK</body></html>")},
		"assets/app.js":   &fstest.MapFile{Data: []byte("console.log('ok');")},
		"favicon.svg":     &fstest.MapFile{Data: []byte("<svg></svg>")},
	}
	app := server.NewApp(cfg, store, staticFS)
	return app, func() { _ = store.Close() }
}

func doReq(t *testing.T, h http.Handler, method, target string, body any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, target, &buf)
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestScryptCompatibility(t *testing.T) {
	hash, err := auth.HashPassword("mySecret123!")
	if err != nil {
		t.Fatalf("HashPassword error: %v", err)
	}
	if !auth.CheckPassword("mySecret123!", hash) {
		t.Fatalf("expected CheckPassword to succeed for %s", hash)
	}
	if auth.CheckPassword("wrongPassword", hash) {
		t.Fatalf("expected CheckPassword to fail for wrong password")
	}
	// Hash generated identically to Node crypto.scryptSync with N=32768, r=8, p=1, unpadded base64
	nodeHash := "scrypt:32768:8:1$MDEyMzQ1Njc4OWFiY2RlZg$e01IZya8Z6quNKH46J/FDOnL5XQ4Lkr7dsootgKQzWA"
	if !auth.CheckPassword("nodeSecret99", nodeHash) {
		t.Fatalf("expected CheckPassword to verify Node-generated scrypt hash")
	}
	if auth.CheckPassword("wrongNodeSecret", nodeHash) {
		t.Fatalf("expected CheckPassword to reject wrong password against Node hash")
	}
	if auth.CheckPassword("abc", "invalid$format") {
		t.Fatalf("expected invalid format to return false")
	}
}

func TestAuthFlowAndTriStateSettings(t *testing.T) {
	app, cleanup := newTestApp(t)
	defer cleanup()

	// 1. Status before setup
	rr := doReq(t, app.Handler, "GET", "/api/auth/status", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("status code: %d", rr.Code)
	}
	var st struct {
		Initialized bool `json:"initialized"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &st)
	if st.Initialized {
		t.Fatalf("expected uninitialized before setup")
	}

	// 2. Setup admin
	rr = doReq(t, app.Handler, "POST", "/api/auth/setup", map[string]string{
		"username": "admin",
		"password": "password123",
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("setup failed (%d): %s", rr.Code, rr.Body.String())
	}
	cookies := rr.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected jwt cookie after setup")
	}

	// 3. Status after setup
	rr = doReq(t, app.Handler, "GET", "/api/auth/status", nil)
	_ = json.Unmarshal(rr.Body.Bytes(), &st)
	if !st.Initialized {
		t.Fatalf("expected initialized after setup")
	}

	// 4. Duplicate setup must fail
	rr = doReq(t, app.Handler, "POST", "/api/auth/setup", map[string]string{
		"username": "admin2",
		"password": "password123",
	})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on duplicate setup, got %d", rr.Code)
	}

	// 5. /api/auth/me authenticated
	rr = doReq(t, app.Handler, "GET", "/api/auth/me", nil, cookies...)
	if rr.Code != http.StatusOK {
		t.Fatalf("/me failed (%d): %s", rr.Code, rr.Body.String())
	}

	// 6. Partial user-settings update must preserve other fields and handle null vs omitted
	rr = doReq(t, app.Handler, "POST", "/api/auth/user-settings", map[string]any{
		"discord_webhook_url": "https://discord.com/api/webhooks/test",
		"youtube_client_id":   "cid-1",
		"youtube_client_secret": "csec-1",
		"live_resolution":     "720p",
	}, cookies...)
	if rr.Code != http.StatusOK {
		t.Fatalf("update settings failed: %d", rr.Code)
	}

	// Update only vod_resolution -> discord_webhook_url and live_resolution must remain intact
	rr = doReq(t, app.Handler, "POST", "/api/auth/user-settings", map[string]any{
		"vod_resolution": "360p",
	}, cookies...)
	if rr.Code != http.StatusOK {
		t.Fatalf("partial update failed: %d", rr.Code)
	}

	rr = doReq(t, app.Handler, "GET", "/api/auth/user-settings", nil, cookies...)
	var us map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &us)
	if us["discord_webhook_url"] != "https://discord.com/api/webhooks/test" || us["live_resolution"] != "720p" || us["vod_resolution"] != "360p" {
		t.Fatalf("unexpected settings after partial update: %+v", us)
	}

	// Disconnect youtube clears client_id & secret
	rr = doReq(t, app.Handler, "POST", "/api/auth/user-settings", map[string]any{
		"disconnect_youtube": true,
	}, cookies...)
	if rr.Code != http.StatusOK {
		t.Fatalf("disconnect youtube failed: %d", rr.Code)
	}
	rr = doReq(t, app.Handler, "GET", "/api/auth/user-settings", nil, cookies...)
	_ = json.Unmarshal(rr.Body.Bytes(), &us)
	if us["youtube_client_id"] != nil || us["youtube_client_secret"] != nil {
		t.Fatalf("expected youtube credentials cleared, got: %+v", us)
	}

	// 7. 2FA setup -> verify -> login requires OTP -> login with OTP -> disable
	rr = doReq(t, app.Handler, "POST", "/api/auth/2fa/setup", nil, cookies...)
	if rr.Code != http.StatusOK {
		t.Fatalf("2fa setup failed: %d %s", rr.Code, rr.Body.String())
	}
	var setup2fa struct {
		Secret string `json:"secret"`
		QR     string `json:"qrcode_data_url"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &setup2fa)
	if setup2fa.Secret == "" || setup2fa.QR == "" {
		t.Fatalf("expected 2fa secret and qr data url")
	}

	code, err := totp.GenerateCode(setup2fa.Secret, time.Now())
	if err != nil {
		t.Fatalf("totp.GenerateCode: %v", err)
	}
	rr = doReq(t, app.Handler, "POST", "/api/auth/2fa/verify", map[string]string{"otp": code}, cookies...)
	if rr.Code != http.StatusOK {
		t.Fatalf("2fa verify failed: %d %s", rr.Code, rr.Body.String())
	}

	// Login without OTP returns requireOtp: true
	rr = doReq(t, app.Handler, "POST", "/api/auth/login", map[string]string{
		"username": "admin",
		"password": "password123",
	})
	var loginRes map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &loginRes)
	if loginRes["requireOtp"] != true {
		t.Fatalf("expected requireOtp=true, got %+v", loginRes)
	}

	// Login with OTP succeeds
	rr = doReq(t, app.Handler, "POST", "/api/auth/login", map[string]string{
		"username": "admin",
		"password": "password123",
		"otp":      code,
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("login with otp failed: %d %s", rr.Code, rr.Body.String())
	}

	// Disable 2FA
	rr = doReq(t, app.Handler, "POST", "/api/auth/2fa/disable", nil, cookies...)
	if rr.Code != http.StatusOK {
		t.Fatalf("2fa disable failed: %d", rr.Code)
	}
}
