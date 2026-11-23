package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/k-atusa/zkzzk/backend/chzzk"
	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/httpx"
	"github.com/pquerna/otp/totp"
	"github.com/skip2/go-qrcode"
	"golang.org/x/crypto/scrypt"
)

type ctxKey struct{}

// UserFromContext extracts the authenticated user attached by RequireAuth.
func UserFromContext(ctx context.Context) *db.User {
	u, _ := ctx.Value(ctxKey{}).(*db.User)
	return u
}

// Service handles authentication, JWT cookies, 2FA, user administration, and user settings.
type Service struct {
	store     *db.Store
	jwtSecret []byte
}

// NewService constructs an auth Service.
func NewService(store *db.Store, jwtSecret string) *Service {
	return &Service{
		store:     store,
		jwtSecret: []byte(jwtSecret),
	}
}

// HashPassword hashes a password in Werkzeug/NestJS compatible `scrypt:32768:8:1$salt$hash` format.
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	const N, r, p = 32768, 8, 1
	derived, err := scrypt.Key([]byte(password), salt, N, r, p, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(
		"scrypt:%d:%d:%d$%s$%s",
		N, r, p,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(derived),
	), nil
}

// CheckPassword verifies a plaintext password against a stored `scrypt:N:r:p$salt$hash` string.
func CheckPassword(password, storedHash string) bool {
	parts := strings.Split(storedHash, "$")
	if len(parts) != 3 {
		return false
	}
	methodParts := strings.Split(parts[0], ":")
	if len(methodParts) != 4 || methodParts[0] != "scrypt" {
		return false
	}
	N, err1 := strconv.Atoi(methodParts[1])
	r, err2 := strconv.Atoi(methodParts[2])
	p, err3 := strconv.Atoi(methodParts[3])
	if err1 != nil || err2 != nil || err3 != nil || N <= 1 || r <= 0 || p <= 0 {
		return false
	}

	saltBytes, err := decodeFlexibleBase64(parts[1])
	if err != nil {
		return false
	}
	hashBytes, err := decodeFlexibleBase64(parts[2])
	if err != nil || len(hashBytes) == 0 {
		return false
	}

	derived, err := scrypt.Key([]byte(password), saltBytes, N, r, p, len(hashBytes))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(hashBytes, derived) == 1
}

func decodeFlexibleBase64(s string) ([]byte, error) {
	s = strings.TrimRight(strings.TrimSpace(s), "=")
	if b, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawURLEncoding.DecodeString(s)
}

func (s *Service) signToken(u *db.User) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"username": u.Username,
		"sub":      u.ID,
		"iat":      now.Unix(),
		"exp":      now.Add(7 * 24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

func (s *Service) setAuthCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "jwt",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
	})
}

// RequireAuth middleware verifies the `jwt` HttpOnly cookie and injects the user into context.
func (s *Service) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("jwt")
		if err != nil || cookie.Value == "" {
			httpx.WriteError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		token, err := jwt.Parse(cookie.Value, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("unexpected signing method")
			}
			return s.jwtSecret, nil
		})
		if err != nil || !token.Valid {
			httpx.WriteError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			httpx.WriteError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		sub, _ := claims["sub"].(string)
		if sub == "" {
			httpx.WriteError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		user, err := s.store.GetUserByID(sub)
		if err != nil || user == nil {
			httpx.WriteError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		ctx := context.WithValue(r.Context(), ctxKey{}, user)
		next(w, r.WithContext(ctx))
	}
}

// --- Handlers ---

func (s *Service) HandleStatus(w http.ResponseWriter, r *http.Request) {
	initialized, err := s.store.IsInitialized()
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{
		"initialized": initialized,
	})
}

func (s *Service) HandleSetup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Username == "" || body.Password == "" {
		httpx.WriteError(w, http.StatusBadRequest, "Username and password required")
		return
	}

	count, err := s.store.CountUsers()
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if count > 0 {
		httpx.WriteError(w, http.StatusBadRequest, "Admin already exists")
		return
	}

	hashStr, err := HashPassword(body.Password)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	user, err := s.store.CreateUser(body.Username, hashStr, true)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Failed to create admin user")
		return
	}
	if err := s.store.MarkInitialized(); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to initialize settings")
		return
	}

	token, err := s.signToken(user)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to sign token")
		return
	}
	s.setAuthCookie(w, token)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Service) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		OTP      string `json:"otp"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	user, err := s.store.GetUserByUsername(body.Username)
	if err != nil || user == nil || !CheckPassword(body.Password, user.PasswordHash) {
		httpx.WriteError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	if user.TOTPEnabled && user.TOTPSecret != nil && *user.TOTPSecret != "" {
		if body.OTP == "" {
			httpx.WriteJSON(w, http.StatusOK, map[string]bool{"requireOtp": true})
			return
		}
		if !totp.Validate(body.OTP, *user.TOTPSecret) {
			httpx.WriteError(w, http.StatusUnauthorized, "Invalid OTP")
			return
		}
	}

	token, err := s.signToken(user)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to sign token")
		return
	}
	s.setAuthCookie(w, token)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"status": "success",
		"user": map[string]any{
			"username": user.Username,
			"is_admin": user.IsAdmin,
		},
	})
}

func (s *Service) HandleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "jwt",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Service) HandleMe(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	hasSecret := user.TOTPSecret != nil && *user.TOTPSecret != ""
	hasCookies := user.NidAut != nil && *user.NidAut != "" && user.NidSes != nil && *user.NidSes != ""

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"username":     user.Username,
		"is_admin":     user.IsAdmin,
		"totp_enabled": user.TOTPEnabled,
		"has_secret":   hasSecret,
		"version":      config.AppVersion,
		"has_cookies":  hasCookies,
	})
}

func (s *Service) HandleChangePassword(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.CurrentPassword == "" || body.NewPassword == "" {
		httpx.WriteError(w, http.StatusBadRequest, "현재 비밀번호와 새 비밀번호를 입력해주세요.")
		return
	}
	if !CheckPassword(body.CurrentPassword, user.PasswordHash) {
		httpx.WriteError(w, http.StatusUnauthorized, "현재 비밀번호가 올바르지 않습니다.")
		return
	}
	if utf8.RuneCountInString(body.NewPassword) < 6 {
		httpx.WriteError(w, http.StatusBadRequest, "새 비밀번호는 6자 이상이어야 합니다.")
		return
	}

	newHash, err := HashPassword(body.NewPassword)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "비밀번호 해싱에 실패했습니다.")
		return
	}
	if err := s.store.UpdateUserPassword(user.ID, newHash); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "비밀번호 변경에 실패했습니다.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Service) HandleListUsers(w http.ResponseWriter, r *http.Request) {
	requester := UserFromContext(r.Context())
	if !requester.IsAdmin {
		httpx.WriteError(w, http.StatusForbidden, "관리자 권한이 필요합니다.")
		return
	}

	users, err := s.store.ListUsers()
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return
	}

	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"id":         u.ID,
			"username":   u.Username,
			"is_admin":   u.IsAdmin,
			"created_at": u.CreatedAt,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (s *Service) HandleCreateUser(w http.ResponseWriter, r *http.Request) {
	requester := UserFromContext(r.Context())
	if !requester.IsAdmin {
		httpx.WriteError(w, http.StatusForbidden, "관리자 권한이 필요합니다.")
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		IsAdmin  bool   `json:"is_admin"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Username == "" || body.Password == "" {
		httpx.WriteError(w, http.StatusBadRequest, "사용자명과 비밀번호를 입력해주세요.")
		return
	}

	existing, err := s.store.GetUserByUsername(body.Username)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if existing != nil {
		httpx.WriteError(w, http.StatusBadRequest, "이미 존재하는 사용자명입니다.")
		return
	}
	if utf8.RuneCountInString(body.Password) < 6 {
		httpx.WriteError(w, http.StatusBadRequest, "비밀번호는 6자 이상이어야 합니다.")
		return
	}

	hashStr, err := HashPassword(body.Password)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "비밀번호 해싱에 실패했습니다.")
		return
	}
	created, err := s.store.CreateUser(body.Username, hashStr, body.IsAdmin)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "사용자 생성에 실패했습니다.")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id":       created.ID,
		"username": created.Username,
		"is_admin": created.IsAdmin,
	})
}

func (s *Service) HandleDeleteUser(w http.ResponseWriter, r *http.Request) {
	requester := UserFromContext(r.Context())
	if !requester.IsAdmin {
		httpx.WriteError(w, http.StatusForbidden, "관리자 권한이 필요합니다.")
		return
	}
	targetID := r.PathValue("id")
	if targetID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "사용자 ID가 필요합니다.")
		return
	}
	if requester.ID == targetID {
		httpx.WriteError(w, http.StatusBadRequest, "자기 자신은 삭제할 수 없습니다.")
		return
	}

	if err := s.store.DeleteUser(targetID); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "사용자 삭제에 실패했습니다.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Service) HandleVerifyCookies(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	var body struct {
		NidAut string `json:"nid_aut"`
		NidSes string `json:"nid_ses"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.NidAut == "" || body.NidSes == "" {
		httpx.WriteError(w, http.StatusBadRequest, "쿠키 값을 입력해주세요.")
		return
	}

	valid, nickname := chzzk.VerifyCookies(body.NidAut, body.NidSes)
	if !valid {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"valid": false})
		return
	}
	if nickname != nil && *nickname != "" {
		_ = s.store.UpdateUserChzzkNickname(user.ID, *nickname)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"valid":    true,
		"nickname": nickname,
	})
}

func (s *Service) Handle2FASetup(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	if user.TOTPEnabled {
		httpx.WriteError(w, http.StatusBadRequest, "2FA is already enabled")
		return
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "ZKZZK",
		AccountName: user.Username,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to generate 2FA secret")
		return
	}

	secret := key.Secret()
	otpauthURL := key.URL()
	if err := s.store.SetUser2FASecret(user.ID, secret, false); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to save 2FA secret")
		return
	}

	pngBytes, err := qrcode.Encode(otpauthURL, qrcode.Medium, 256)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to generate QR code")
		return
	}
	qrDataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"status":          "success",
		"secret":          secret,
		"otpauthUrl":      otpauthURL,
		"qrcode_data_url": qrDataURL,
	})
}

func (s *Service) Handle2FAVerify(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	var body struct {
		OTP string `json:"otp"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if user.TOTPSecret == nil || *user.TOTPSecret == "" {
		httpx.WriteError(w, http.StatusBadRequest, "2FA not initialized")
		return
	}
	if !totp.Validate(body.OTP, *user.TOTPSecret) {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid OTP")
		return
	}
	if err := s.store.EnableUser2FA(user.ID); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to enable 2FA")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"enabled": true})
}

func (s *Service) Handle2FADisable(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	if err := s.store.DisableUser2FA(user.ID); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to disable 2FA")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"enabled": false})
}

func (s *Service) HandleGetUserSettings(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	if user.NidAut != nil && *user.NidAut != "" && user.NidSes != nil && *user.NidSes != "" && (user.ChzzkNickname == nil || *user.ChzzkNickname == "") {
		if valid, nickname := chzzk.VerifyCookies(*user.NidAut, *user.NidSes); valid && nickname != nil && *nickname != "" {
			_ = s.store.UpdateUserChzzkNickname(user.ID, *nickname)
			if refreshed, err := s.store.GetUserByID(user.ID); err == nil && refreshed != nil {
				user = refreshed
			}
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"discord_webhook_url":       user.DiscordWebhookURL,
		"discord_webhook_use_embed": user.DiscordWebhookUseEmbed,
		"youtube_client_id":         user.YoutubeClientID,
		"youtube_client_secret":     user.YoutubeClientSecret,
		"youtube_connected":         user.YoutubeRefreshToken != nil && *user.YoutubeRefreshToken != "",
		"youtube_channel_title":     user.YoutubeChannelTitle,
		"youtube_auto_upload":       user.YoutubeAutoUpload,
		"youtube_privacy_status":    user.YoutubePrivacyStatus,
		"delete_after_upload":       user.DeleteAfterUpload,
		"nid_aut":                   user.NidAut,
		"nid_ses":                   user.NidSes,
		"chzzk_nickname":            user.ChzzkNickname,
		"live_resolution":           user.LiveResolution,
		"vod_resolution":            user.VodResolution,
	})
}

func (s *Service) HandleUpdateUserSettings(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	var body struct {
		DiscordWebhookURL       httpx.Nullable[string] `json:"discord_webhook_url"`
		DiscordWebhookUseEmbed  httpx.Nullable[bool]   `json:"discord_webhook_use_embed"`
		YoutubeClientID         httpx.Nullable[string] `json:"youtube_client_id"`
		YoutubeClientSecret     httpx.Nullable[string] `json:"youtube_client_secret"`
		NidAut                  httpx.Nullable[string] `json:"nid_aut"`
		NidSes                  httpx.Nullable[string] `json:"nid_ses"`
		ChzzkNickname           httpx.Nullable[string] `json:"chzzk_nickname"`
		YoutubeAutoUpload       httpx.Nullable[bool]   `json:"youtube_auto_upload"`
		YoutubePrivacyStatus    httpx.Nullable[string] `json:"youtube_privacy_status"`
		DeleteAfterUpload       httpx.Nullable[bool]   `json:"delete_after_upload"`
		LiveResolution          httpx.Nullable[string] `json:"live_resolution"`
		VodResolution           httpx.Nullable[string] `json:"vod_resolution"`
		DisconnectYoutube       bool                   `json:"disconnect_youtube"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updates := make(map[string]any)
	applyNullableStr(updates, "discord_webhook_url", body.DiscordWebhookURL)
	applyNullableBool(updates, "discord_webhook_use_embed", body.DiscordWebhookUseEmbed)
	applyNullableStr(updates, "youtube_client_id", body.YoutubeClientID)
	applyNullableStr(updates, "youtube_client_secret", body.YoutubeClientSecret)
	applyNullableStr(updates, "nid_aut", body.NidAut)
	applyNullableStr(updates, "nid_ses", body.NidSes)
	applyNullableStr(updates, "chzzk_nickname", body.ChzzkNickname)
	applyNullableBool(updates, "youtube_auto_upload", body.YoutubeAutoUpload)
	if body.YoutubePrivacyStatus.Set && body.YoutubePrivacyStatus.Valid {
		switch body.YoutubePrivacyStatus.Value {
		case "public", "unlisted", "private":
			updates["youtube_privacy_status"] = body.YoutubePrivacyStatus.Value
		default:
			httpx.WriteError(w, http.StatusBadRequest, "올바르지 않은 유튜브 공개 설정입니다.")
			return
		}
	}
	applyNullableBool(updates, "delete_after_upload", body.DeleteAfterUpload)
	applyNullableStr(updates, "live_resolution", body.LiveResolution)
	applyNullableStr(updates, "vod_resolution", body.VodResolution)

	if body.NidAut.Set && (!body.NidAut.Valid || body.NidAut.Value == "") {
		updates["nid_aut"] = nil
		updates["nid_ses"] = nil
		updates["chzzk_nickname"] = nil
	}

	if body.DisconnectYoutube || (body.YoutubeClientID.Set && !body.YoutubeClientID.Valid) {
		updates["youtube_client_id"] = nil
		updates["youtube_client_secret"] = nil
		updates["youtube_refresh_token"] = nil
		updates["youtube_channel_title"] = nil
	}

	if err := s.store.UpdateUserSettings(user.ID, updates); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Failed to update settings")
		return
	}

	// If cookies were supplied without explicit chzzk_nickname, auto-resolve the Chzzk nickname.
	if body.NidAut.Set && body.NidAut.Valid && body.NidAut.Value != "" &&
		body.NidSes.Set && body.NidSes.Valid && body.NidSes.Value != "" &&
		(!body.ChzzkNickname.Set || !body.ChzzkNickname.Valid || body.ChzzkNickname.Value == "") {
		if valid, nickname := chzzk.VerifyCookies(body.NidAut.Value, body.NidSes.Value); valid && nickname != nil && *nickname != "" {
			_ = s.store.UpdateUserChzzkNickname(user.ID, *nickname)
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func applyNullableStr(updates map[string]any, col string, f httpx.Nullable[string]) {
	if !f.Set {
		return
	}
	if f.Valid {
		updates[col] = f.Value
	} else {
		updates[col] = nil
	}
}

func applyNullableBool(updates map[string]any, col string, f httpx.Nullable[bool]) {
	if !f.Set || !f.Valid {
		return
	}
	updates[col] = f.Value
}
