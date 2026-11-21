package httpx

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var sanitizeFilenameRe = regexp.MustCompile(`[<>:"/\\|?*]`)
var streamOpeningRe = regexp.MustCompile(`(?i)Opening stream:\s*([a-zA-Z0-9_]+)`)
var dimRe = regexp.MustCompile(`^(\d+)[xX](\d+)$`)
var qualityNumRe = regexp.MustCompile(`(?i)^(\d+)p?(60|30)?$`)

// WriteJSON serializes v as JSON and writes it with the given HTTP status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a NestJS-compatible JSON error payload with a "message" key.
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"message": msg})
}

// DecodeJSON decodes a JSON request body into dst.
func DecodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil
	}
	return json.Unmarshal(body, dst)
}

// Nullable distinguishes omitted JSON fields from explicit null and concrete values.
type Nullable[T any] struct {
	Set   bool
	Valid bool
	Value T
}

// UnmarshalJSON records whether the field appeared in JSON and whether it was null.
func (n *Nullable[T]) UnmarshalJSON(data []byte) error {
	n.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		n.Valid = false
		var zero T
		n.Value = zero
		return nil
	}
	n.Valid = true
	return json.Unmarshal(data, &n.Value)
}

// SanitizeFilename strips characters disallowed across Windows/macOS/Linux filesystems.
func SanitizeFilename(name string) string {
	return strings.TrimSpace(sanitizeFilenameRe.ReplaceAllString(name, ""))
}

// ParseStreamlinkResolution extracts a normalized resolution label (e.g., "1080p") from streamlink logs.
func ParseStreamlinkResolution(text string) (string, bool) {
	m := streamOpeningRe.FindStringSubmatch(text)
	if len(m) < 2 || m[1] == "" {
		return "", false
	}
	resStr := m[1]
	if dm := dimRe.FindStringSubmatch(resStr); len(dm) == 3 {
		w, _ := strconv.Atoi(dm[1])
		h, _ := strconv.Atoi(dm[2])
		minDim := w
		if h < minDim {
			minDim = h
		}
		return strconv.Itoa(minDim) + "p", true
	}
	if nm := qualityNumRe.FindStringSubmatch(resStr); len(nm) >= 2 {
		num, _ := strconv.Atoi(nm[1])
		if num == 1920 {
			num = 1080
		} else if num == 1280 {
			num = 720
		}
		return strconv.Itoa(num) + "p", true
	}
	return resStr, true
}

// RequestOrigin computes the external origin (scheme://host) honoring reverse proxy headers.
func RequestOrigin(r *http.Request) string {
	proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0])
	if host == "" {
		host = r.Host
	}
	return proto + "://" + host
}
