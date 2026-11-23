package db

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// FlexTime safely scans SQLite timestamps stored as ISO-8601 text, SQLite datetime text, or integer epoch.
type FlexTime struct {
	Time  time.Time
	Valid bool
}

var timeLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02 15:04:05.999999999-07:00",
	"2006-01-02 15:04:05.999999999",
	"2006-01-02 15:04:05",
	"2006-01-02T15:04:05.999999999",
	"2006-01-02T15:04:05",
}

func (ft *FlexTime) Scan(src any) error {
	if src == nil {
		ft.Valid = false
		ft.Time = time.Time{}
		return nil
	}
	switch v := src.(type) {
	case time.Time:
		ft.Time = v
		ft.Valid = true
		return nil
	case int64:
		if v > 1e12 {
			ft.Time = time.UnixMilli(v)
		} else {
			ft.Time = time.Unix(v, 0)
		}
		ft.Valid = true
		return nil
	case []byte:
		return ft.parseString(string(v))
	case string:
		return ft.parseString(v)
	default:
		ft.Valid = false
		return nil
	}
}

func (ft *FlexTime) parseString(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		ft.Valid = false
		return nil
	}
	for _, layout := range timeLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			ft.Time = t
			ft.Valid = true
			return nil
		}
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		if n > 1e12 {
			ft.Time = time.UnixMilli(n)
		} else {
			ft.Time = time.Unix(n, 0)
		}
		ft.Valid = true
		return nil
	}
	ft.Valid = false
	return nil
}

// FormatISO formats a timestamp in UTC RFC3339 millisecond format matching Prisma's SQLite representation.
func FormatISO(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// FlexBool safely scans SQLite boolean values stored as 0/1, bool, or text.
type FlexBool struct {
	Bool  bool
	Valid bool
}

func (fb *FlexBool) Scan(src any) error {
	if src == nil {
		fb.Valid = false
		fb.Bool = false
		return nil
	}
	switch v := src.(type) {
	case bool:
		fb.Bool = v
		fb.Valid = true
	case int64:
		fb.Bool = v != 0
		fb.Valid = true
	case []byte:
		return fb.parseString(string(v))
	case string:
		return fb.parseString(v)
	default:
		fb.Valid = false
	}
	return nil
}

func (fb *FlexBool) parseString(s string) error {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "1", "true", "t", "yes":
		fb.Bool = true
		fb.Valid = true
	case "0", "false", "f", "no":
		fb.Bool = false
		fb.Valid = true
	default:
		fb.Valid = false
	}
	return nil
}

// User corresponds to the `account` table.
type User struct {
	ID                     string
	Username               string
	PasswordHash           string
	IsAdmin                bool
	CreatedAt              *time.Time
	TOTPSecret             *string
	TOTPEnabled            bool
	NidAut                 *string
	NidSes                 *string
	ChzzkNickname          *string
	DiscordWebhookURL      *string
	DiscordWebhookUseEmbed bool
	YoutubeClientID        *string
	YoutubeClientSecret    *string
	YoutubeRefreshToken    *string
	YoutubeChannelTitle    *string
	YoutubeRedirectURI     *string
	YoutubeAutoUpload      bool
	YoutubePrivacyStatus   string
	DeleteAfterUpload      bool
	LiveResolution         string
	VodResolution          string
}

// Streamer corresponds to the `streamers` table.
type Streamer struct {
	ID                       string     `json:"id"`
	ChannelURL               string     `json:"channel_url"`
	Nickname                 *string    `json:"nickname"`
	UserID                   *string    `json:"user_id"`
	CookieUserID             *string    `json:"cookie_user_id"`
	IsActive                 bool       `json:"is_active"`
	CreatedAt                *time.Time `json:"created_at"`
	LastChecked              *time.Time `json:"last_checked"`
	LastLive                 *time.Time `json:"last_live"`
	IsRecording              bool       `json:"is_recording"`
	IsPaused                 bool       `json:"is_paused"`
	CurrentBroadcastTitle    *string    `json:"current_broadcast_title"`
	CurrentBroadcastCategory *string    `json:"current_broadcast_category"`
	CurrentBroadcastTagsRaw  *string    `json:"-"`
	CurrentBroadcastTags     []string   `json:"current_broadcast_tags"`
	ProcessID                *int       `json:"process_id"`
	User                     *UserBrief `json:"user,omitempty"`
}

// UserBrief is a safe subset of User included when admins list all streamers.
type UserBrief struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
}

// PopulateTags decodes CurrentBroadcastTagsRaw JSON array into CurrentBroadcastTags.
func (s *Streamer) PopulateTags() {
	s.CurrentBroadcastTags = []string{}
	if s.CurrentBroadcastTagsRaw != nil && *s.CurrentBroadcastTagsRaw != "" {
		var parsed []string
		if err := json.Unmarshal([]byte(*s.CurrentBroadcastTagsRaw), &parsed); err == nil && parsed != nil {
			s.CurrentBroadcastTags = parsed
		}
	}
}

// Recording corresponds to the `recording` table.
type Recording struct {
	ID             string     `json:"id"`
	StreamerID     *string    `json:"streamer_id"`
	UserID         *string    `json:"user_id"`
	Filename       string     `json:"filename"`
	Title          *string    `json:"title"`
	Resolution     *string    `json:"resolution"`
	CreatedAt      *time.Time `json:"created_at"`
	YoutubeStatus  *string    `json:"youtube_status"`
	YoutubeVideoID *string    `json:"youtube_video_id"`
	IsRecording    bool       `json:"is_recording"`
	FileHash       *string    `json:"file_hash"`
}

func nullStrPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	v := ns.String
	return &v
}

func nullIntPtr(ni sql.NullInt64) *int {
	if !ni.Valid {
		return nil
	}
	v := int(ni.Int64)
	return &v
}

func flexTimePtr(ft FlexTime) *time.Time {
	if !ft.Valid {
		return nil
	}
	t := ft.Time
	return &t
}
