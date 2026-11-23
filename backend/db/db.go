package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// Store wraps SQLite database operations for ZKZZK.
type Store struct {
	DB *sql.DB
}

// Open opens the SQLite database file, configures pragmas, and ensures the schema is up to date.
func Open(dbPath string) (*Store, error) {
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}

	sqlDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite handles concurrent goroutines cleanly with a single connection + busy timeout, preventing SQLITE_BUSY errors.
	sqlDB.SetMaxOpenConns(1)

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA busy_timeout=5000;",
	} {
		if _, err := sqlDB.Exec(pragma); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("apply pragma %q: %w", pragma, err)
		}
	}

	s := &Store{DB: sqlDB}
	if err := s.InitSchema(); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.DB.Close()
}

// InitSchema creates tables if missing and adds any columns absent from legacy Prisma/Flask databases.
func (s *Store) InitSchema() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS "account" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"username" TEXT NOT NULL,
			"password_hash" TEXT NOT NULL,
			"is_admin" BOOLEAN,
			"created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
			"totp_secret" TEXT,
			"totp_enabled" BOOLEAN,
			"nid_aut" TEXT,
			"nid_ses" TEXT,
			"chzzk_nickname" TEXT,
			"discord_webhook_url" TEXT,
			"discord_webhook_use_embed" BOOLEAN DEFAULT true,
			"youtube_client_id" TEXT,
			"youtube_client_secret" TEXT,
			"youtube_refresh_token" TEXT,
			"youtube_channel_title" TEXT,
			"youtube_redirect_uri" TEXT,
			"youtube_auto_upload" BOOLEAN DEFAULT false,
			"youtube_privacy_status" TEXT DEFAULT 'unlisted',
			"delete_after_upload" BOOLEAN DEFAULT false,
			"live_resolution" TEXT DEFAULT '1080p',
			"vod_resolution" TEXT DEFAULT '1080p'
		);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "account_username_key" ON "account"("username");`,
		`CREATE TABLE IF NOT EXISTS "settings" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"initialized" BOOLEAN
		);`,
		`CREATE TABLE IF NOT EXISTS "streamers" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"channel_url" TEXT NOT NULL,
			"nickname" TEXT,
			"user_id" TEXT,
			"cookie_user_id" TEXT,
			"is_active" BOOLEAN,
			"created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
			"last_checked" DATETIME,
			"last_live" DATETIME,
			"is_recording" BOOLEAN,
			"is_paused" BOOLEAN DEFAULT false,
			"current_broadcast_title" TEXT,
			"current_broadcast_category" TEXT,
			"current_broadcast_tags" TEXT,
			"process_id" INTEGER,
			CONSTRAINT "streamers_cookie_user_id_fkey" FOREIGN KEY ("cookie_user_id") REFERENCES "account" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
			CONSTRAINT "streamers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
		);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "streamers_user_id_channel_url_key" ON "streamers"("user_id", "channel_url");`,
		`CREATE TABLE IF NOT EXISTS "recording" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"streamer_id" TEXT,
			"user_id" TEXT,
			"filename" TEXT NOT NULL,
			"title" TEXT,
			"resolution" TEXT,
			"created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
			"youtube_status" TEXT,
			"youtube_video_id" TEXT,
			"is_recording" BOOLEAN DEFAULT false,
			"file_hash" TEXT,
			CONSTRAINT "recording_streamer_id_fkey" FOREIGN KEY ("streamer_id") REFERENCES "streamers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
			CONSTRAINT "recording_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
		);`,
	}

	for _, stmt := range stmts {
		if _, err := s.DB.Exec(stmt); err != nil {
			return fmt.Errorf("init schema: %w", err)
		}
	}

	migrations := map[string][]struct {
		col string
		def string
	}{
		"account": {
			{"chzzk_nickname", "TEXT"},
			{"discord_webhook_url", "TEXT"},
			{"discord_webhook_use_embed", "BOOLEAN DEFAULT true"},
			{"youtube_client_id", "TEXT"},
			{"youtube_client_secret", "TEXT"},
			{"youtube_refresh_token", "TEXT"},
			{"youtube_channel_title", "TEXT"},
			{"youtube_redirect_uri", "TEXT"},
			{"youtube_auto_upload", "BOOLEAN DEFAULT false"},
			{"youtube_privacy_status", "TEXT DEFAULT 'unlisted'"},
			{"delete_after_upload", "BOOLEAN DEFAULT false"},
			{"live_resolution", "TEXT DEFAULT '1080p'"},
			{"vod_resolution", "TEXT DEFAULT '1080p'"},
		},
		"streamers": {
			{"cookie_user_id", "TEXT"},
			{"is_paused", "BOOLEAN DEFAULT false"},
			{"current_broadcast_title", "TEXT"},
			{"current_broadcast_category", "TEXT"},
			{"current_broadcast_tags", "TEXT"},
			{"process_id", "INTEGER"},
		},
		"recording": {
			{"title", "TEXT"},
			{"resolution", "TEXT"},
			{"youtube_status", "TEXT"},
			{"youtube_video_id", "TEXT"},
			{"is_recording", "BOOLEAN DEFAULT false"},
			{"file_hash", "TEXT"},
		},
	}

	for table, cols := range migrations {
		existing, err := s.tableColumns(table)
		if err != nil {
			return err
		}
		for _, c := range cols {
			if !existing[c.col] {
				alter := fmt.Sprintf(`ALTER TABLE "%s" ADD COLUMN "%s" %s;`, table, c.col, c.def)
				if _, err := s.DB.Exec(alter); err != nil {
					return fmt.Errorf("migrate %s.%s: %w", table, c.col, err)
				}
			}
		}
	}
	return nil
}

func (s *Store) tableColumns(table string) (map[string]bool, error) {
	rows, err := s.DB.Query(fmt.Sprintf(`PRAGMA table_info("%s");`, table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols[name] = true
	}
	return cols, rows.Err()
}

// --- Settings / Setup ---

func (s *Store) CountUsers() (int, error) {
	var count int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM "account"`).Scan(&count)
	return count, err
}

func (s *Store) IsInitialized() (bool, error) {
	count, err := s.CountUsers()
	if err != nil || count == 0 {
		return false, err
	}
	var initVal FlexBool
	err = s.DB.QueryRow(`SELECT "initialized" FROM "settings" LIMIT 1`).Scan(&initVal)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return initVal.Valid && initVal.Bool, nil
}

func (s *Store) MarkInitialized() error {
	var existingID string
	err := s.DB.QueryRow(`SELECT "id" FROM "settings" LIMIT 1`).Scan(&existingID)
	if err == sql.ErrNoRows {
		_, err = s.DB.Exec(`INSERT INTO "settings" ("id", "initialized") VALUES (?, 1)`, uuid.NewString())
		return err
	}
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`UPDATE "settings" SET "initialized" = 1 WHERE "id" = ?`, existingID)
	return err
}

// --- Users ---

const userSelectCols = `"id", "username", "password_hash", "is_admin", "created_at",
	"totp_secret", "totp_enabled", "nid_aut", "nid_ses", "chzzk_nickname",
	"discord_webhook_url", "discord_webhook_use_embed",
	"youtube_client_id", "youtube_client_secret", "youtube_refresh_token",
	"youtube_channel_title", "youtube_redirect_uri", "youtube_auto_upload",
	"youtube_privacy_status", "delete_after_upload", "live_resolution", "vod_resolution"`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUser(rs rowScanner) (*User, error) {
	var (
		u                     User
		isAdmin               FlexBool
		createdAt             FlexTime
		totpSecret            sql.NullString
		totpEnabled           FlexBool
		nidAut                sql.NullString
		nidSes                sql.NullString
		chzzkNick             sql.NullString
		webhookURL            sql.NullString
		webhookEmbed          FlexBool
		ytClientID            sql.NullString
		ytClientSecret        sql.NullString
		ytRefreshToken        sql.NullString
		ytChannelTitle        sql.NullString
		ytRedirectURI         sql.NullString
		ytAutoUpload          FlexBool
		ytPrivacyStatus       sql.NullString
		deleteAfterUpload     FlexBool
		liveRes               sql.NullString
		vodRes                sql.NullString
	)
	err := rs.Scan(
		&u.ID, &u.Username, &u.PasswordHash, &isAdmin, &createdAt,
		&totpSecret, &totpEnabled, &nidAut, &nidSes, &chzzkNick,
		&webhookURL, &webhookEmbed,
		&ytClientID, &ytClientSecret, &ytRefreshToken,
		&ytChannelTitle, &ytRedirectURI, &ytAutoUpload,
		&ytPrivacyStatus, &deleteAfterUpload, &liveRes, &vodRes,
	)
	if err != nil {
		return nil, err
	}
	u.IsAdmin = isAdmin.Valid && isAdmin.Bool
	u.CreatedAt = flexTimePtr(createdAt)
	u.TOTPSecret = nullStrPtr(totpSecret)
	u.TOTPEnabled = totpEnabled.Valid && totpEnabled.Bool
	u.NidAut = nullStrPtr(nidAut)
	u.NidSes = nullStrPtr(nidSes)
	u.ChzzkNickname = nullStrPtr(chzzkNick)
	u.DiscordWebhookURL = nullStrPtr(webhookURL)
	u.DiscordWebhookUseEmbed = !webhookEmbed.Valid || webhookEmbed.Bool
	u.YoutubeClientID = nullStrPtr(ytClientID)
	u.YoutubeClientSecret = nullStrPtr(ytClientSecret)
	u.YoutubeRefreshToken = nullStrPtr(ytRefreshToken)
	u.YoutubeChannelTitle = nullStrPtr(ytChannelTitle)
	u.YoutubeRedirectURI = nullStrPtr(ytRedirectURI)
	u.YoutubeAutoUpload = ytAutoUpload.Valid && ytAutoUpload.Bool
	switch ytPrivacyStatus.String {
	case "public", "unlisted", "private":
		u.YoutubePrivacyStatus = ytPrivacyStatus.String
	default:
		u.YoutubePrivacyStatus = "unlisted"
	}
	u.DeleteAfterUpload = deleteAfterUpload.Valid && deleteAfterUpload.Bool
	if liveRes.Valid && liveRes.String != "" {
		u.LiveResolution = liveRes.String
	} else {
		u.LiveResolution = "1080p"
	}
	if vodRes.Valid && vodRes.String != "" {
		u.VodResolution = vodRes.String
	} else {
		u.VodResolution = "1080p"
	}
	return &u, nil
}

func (s *Store) GetUserByID(id string) (*User, error) {
	row := s.DB.QueryRow(`SELECT `+userSelectCols+` FROM "account" WHERE "id" = ?`, id)
	u, err := scanUser(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (s *Store) GetUserByUsername(username string) (*User, error) {
	row := s.DB.QueryRow(`SELECT `+userSelectCols+` FROM "account" WHERE "username" = ?`, username)
	u, err := scanUser(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.DB.Query(`SELECT ` + userSelectCols + ` FROM "account"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *u)
	}
	return users, rows.Err()
}

func (s *Store) CreateUser(username, passwordHash string, isAdmin bool) (*User, error) {
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := s.DB.Exec(
		`INSERT INTO "account" ("id", "username", "password_hash", "is_admin", "created_at") VALUES (?, ?, ?, ?, ?)`,
		id, username, passwordHash, isAdmin, FormatISO(now),
	)
	if err != nil {
		return nil, err
	}
	return s.GetUserByID(id)
}

func (s *Store) DeleteUser(id string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`UPDATE "streamers" SET "cookie_user_id" = NULL WHERE "cookie_user_id" = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM "account" WHERE "id" = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpdateUserPassword(id, passwordHash string) error {
	_, err := s.DB.Exec(`UPDATE "account" SET "password_hash" = ? WHERE "id" = ?`, passwordHash, id)
	return err
}

func (s *Store) UpdateUserChzzkNickname(id, nickname string) error {
	_, err := s.DB.Exec(`UPDATE "account" SET "chzzk_nickname" = ? WHERE "id" = ?`, nickname, id)
	return err
}

func (s *Store) SetUser2FASecret(id, secret string, enabled bool) error {
	_, err := s.DB.Exec(`UPDATE "account" SET "totp_secret" = ?, "totp_enabled" = ? WHERE "id" = ?`, secret, enabled, id)
	return err
}

func (s *Store) EnableUser2FA(id string) error {
	_, err := s.DB.Exec(`UPDATE "account" SET "totp_enabled" = 1 WHERE "id" = ?`, id)
	return err
}

func (s *Store) DisableUser2FA(id string) error {
	_, err := s.DB.Exec(`UPDATE "account" SET "totp_enabled" = 0, "totp_secret" = NULL WHERE "id" = ?`, id)
	return err
}

var allowedAccountSettingCols = map[string]bool{
	"discord_webhook_url":       true,
	"discord_webhook_use_embed": true,
	"youtube_client_id":         true,
	"youtube_client_secret":     true,
	"youtube_refresh_token":     true,
	"youtube_channel_title":     true,
	"youtube_redirect_uri":      true,
	"youtube_auto_upload":       true,
	"youtube_privacy_status":    true,
	"delete_after_upload":       true,
	"nid_aut":                   true,
	"nid_ses":                   true,
	"chzzk_nickname":            true,
	"live_resolution":           true,
	"vod_resolution":            true,
}

// UpdateUserSettings updates an allowlisted set of columns on the `account` table.
func (s *Store) UpdateUserSettings(id string, updates map[string]any) error {
	if len(updates) == 0 {
		return nil
	}
	setClauses := make([]string, 0, len(updates))
	args := make([]any, 0, len(updates)+1)
	for col, val := range updates {
		if !allowedAccountSettingCols[col] {
			return fmt.Errorf("disallowed setting column: %s", col)
		}
		setClauses = append(setClauses, fmt.Sprintf(`"%s" = ?`, col))
		args = append(args, val)
	}
	args = append(args, id)
	query := fmt.Sprintf(`UPDATE "account" SET %s WHERE "id" = ?`, strings.Join(setClauses, ", "))
	_, err := s.DB.Exec(query, args...)
	return err
}

// --- Streamers ---

const streamerSelectCols = `"id", "channel_url", "nickname", "user_id", "cookie_user_id",
	"is_active", "created_at", "last_checked", "last_live", "is_recording", "is_paused",
	"current_broadcast_title", "current_broadcast_category", "current_broadcast_tags", "process_id"`

func scanStreamer(rs rowScanner) (*Streamer, error) {
	var (
		st           Streamer
		nick         sql.NullString
		userID       sql.NullString
		cookieUserID sql.NullString
		isActive     FlexBool
		createdAt    FlexTime
		lastChecked  FlexTime
		lastLive     FlexTime
		isRecording  FlexBool
		isPaused     FlexBool
		bTitle       sql.NullString
		bCat         sql.NullString
		bTags        sql.NullString
		pid          sql.NullInt64
	)
	err := rs.Scan(
		&st.ID, &st.ChannelURL, &nick, &userID, &cookieUserID,
		&isActive, &createdAt, &lastChecked, &lastLive, &isRecording, &isPaused,
		&bTitle, &bCat, &bTags, &pid,
	)
	if err != nil {
		return nil, err
	}
	st.Nickname = nullStrPtr(nick)
	st.UserID = nullStrPtr(userID)
	st.CookieUserID = nullStrPtr(cookieUserID)
	st.IsActive = isActive.Valid && isActive.Bool
	st.CreatedAt = flexTimePtr(createdAt)
	st.LastChecked = flexTimePtr(lastChecked)
	st.LastLive = flexTimePtr(lastLive)
	st.IsRecording = isRecording.Valid && isRecording.Bool
	st.IsPaused = isPaused.Valid && isPaused.Bool
	st.CurrentBroadcastTitle = nullStrPtr(bTitle)
	st.CurrentBroadcastCategory = nullStrPtr(bCat)
	st.CurrentBroadcastTagsRaw = nullStrPtr(bTags)
	st.ProcessID = nullIntPtr(pid)
	st.PopulateTags()
	return &st, nil
}

const streamerAliasedSelectCols = `s."id", s."channel_url", s."nickname", s."user_id", s."cookie_user_id",
	s."is_active", s."created_at", s."last_checked", s."last_live", s."is_recording", s."is_paused",
	s."current_broadcast_title", s."current_broadcast_category", s."current_broadcast_tags", s."process_id"`

func (s *Store) ListStreamers(userID string, isAdmin bool) ([]Streamer, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if isAdmin {
		rows, err = s.DB.Query(`
			SELECT ` + streamerAliasedSelectCols + `, u."id", u."username", u."is_admin"
			FROM "streamers" s
			LEFT JOIN "account" u ON s."user_id" = u."id"`)
	} else {
		rows, err = s.DB.Query(`SELECT `+streamerSelectCols+` FROM "streamers" WHERE "user_id" = ?`, userID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	streamers := make([]Streamer, 0)
	for rows.Next() {
		if isAdmin {
			var (
				st           Streamer
				nick         sql.NullString
				uID          sql.NullString
				cookieUserID sql.NullString
				isActive     FlexBool
				createdAt    FlexTime
				lastChecked  FlexTime
				lastLive     FlexTime
				isRecording  FlexBool
				isPaused     FlexBool
				bTitle       sql.NullString
				bCat         sql.NullString
				bTags        sql.NullString
				pid          sql.NullInt64
				joinUID      sql.NullString
				joinUName    sql.NullString
				joinUAdmin   FlexBool
			)
			if err := rows.Scan(
				&st.ID, &st.ChannelURL, &nick, &uID, &cookieUserID,
				&isActive, &createdAt, &lastChecked, &lastLive, &isRecording, &isPaused,
				&bTitle, &bCat, &bTags, &pid,
				&joinUID, &joinUName, &joinUAdmin,
			); err != nil {
				return nil, err
			}
			st.Nickname = nullStrPtr(nick)
			st.UserID = nullStrPtr(uID)
			st.CookieUserID = nullStrPtr(cookieUserID)
			st.IsActive = isActive.Valid && isActive.Bool
			st.CreatedAt = flexTimePtr(createdAt)
			st.LastChecked = flexTimePtr(lastChecked)
			st.LastLive = flexTimePtr(lastLive)
			st.IsRecording = isRecording.Valid && isRecording.Bool
			st.IsPaused = isPaused.Valid && isPaused.Bool
			st.CurrentBroadcastTitle = nullStrPtr(bTitle)
			st.CurrentBroadcastCategory = nullStrPtr(bCat)
			st.CurrentBroadcastTagsRaw = nullStrPtr(bTags)
			st.ProcessID = nullIntPtr(pid)
			st.PopulateTags()
			if joinUID.Valid {
				st.User = &UserBrief{
					ID:       joinUID.String,
					Username: joinUName.String,
					IsAdmin:  joinUAdmin.Valid && joinUAdmin.Bool,
				}
			}
			streamers = append(streamers, st)
		} else {
			st, err := scanStreamer(rows)
			if err != nil {
				return nil, err
			}
			streamers = append(streamers, *st)
		}
	}
	return streamers, rows.Err()
}

func (s *Store) GetStreamerByID(id string) (*Streamer, error) {
	row := s.DB.QueryRow(`SELECT `+streamerSelectCols+` FROM "streamers" WHERE "id" = ?`, id)
	st, err := scanStreamer(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return st, err
}

func (s *Store) GetStreamerByUserAndURL(userID, channelURL string) (*Streamer, error) {
	row := s.DB.QueryRow(`SELECT `+streamerSelectCols+` FROM "streamers" WHERE "user_id" = ? AND "channel_url" = ?`, userID, channelURL)
	st, err := scanStreamer(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return st, err
}

func (s *Store) ListActiveStreamers() ([]Streamer, error) {
	rows, err := s.DB.Query(`SELECT ` + streamerSelectCols + ` FROM "streamers" WHERE "is_active" = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Streamer
	for rows.Next() {
		st, err := scanStreamer(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *st)
	}
	return list, rows.Err()
}

func (s *Store) ListRecordingStreamers() ([]Streamer, error) {
	rows, err := s.DB.Query(`SELECT ` + streamerSelectCols + ` FROM "streamers" WHERE "is_recording" = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Streamer
	for rows.Next() {
		st, err := scanStreamer(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *st)
	}
	return list, rows.Err()
}

func (s *Store) CreateStreamer(channelURL, nickname, userID string) (*Streamer, error) {
	id := uuid.NewString()
	now := FormatISO(time.Now().UTC())
	_, err := s.DB.Exec(
		`INSERT INTO "streamers" ("id", "channel_url", "nickname", "user_id", "cookie_user_id", "is_active", "created_at", "is_recording", "is_paused")
		 VALUES (?, ?, ?, ?, ?, 1, ?, 0, 0)`,
		id, channelURL, nickname, userID, userID, now,
	)
	if err != nil {
		return nil, err
	}
	return s.GetStreamerByID(id)
}

func (s *Store) DeleteStreamer(id string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`UPDATE "recording" SET "streamer_id" = NULL WHERE "streamer_id" = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM "streamers" WHERE "id" = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ResetStreamerState(id string, isPaused bool, clearTitle bool) error {
	if clearTitle {
		_, err := s.DB.Exec(
			`UPDATE "streamers" SET "is_recording" = 0, "process_id" = NULL, "current_broadcast_title" = NULL, "is_paused" = ? WHERE "id" = ?`,
			isPaused, id,
		)
		return err
	}
	_, err := s.DB.Exec(
		`UPDATE "streamers" SET "is_recording" = 0, "process_id" = NULL, "is_paused" = ? WHERE "id" = ?`,
		isPaused, id,
	)
	return err
}

func (s *Store) ClearStreamerProcess(id string) error {
	_, err := s.DB.Exec(`UPDATE "streamers" SET "is_recording" = 0, "process_id" = NULL WHERE "id" = ?`, id)
	return err
}

func (s *Store) SetStreamerPaused(id string, paused bool) (*Streamer, error) {
	if _, err := s.DB.Exec(`UPDATE "streamers" SET "is_paused" = ? WHERE "id" = ?`, paused, id); err != nil {
		return nil, err
	}
	return s.GetStreamerByID(id)
}

func (s *Store) SetStreamerCookieUser(id string, cookieUserID *string) error {
	_, err := s.DB.Exec(`UPDATE "streamers" SET "cookie_user_id" = ? WHERE "id" = ?`, cookieUserID, id)
	return err
}

func (s *Store) UpdateStreamerLiveChecked(id string, title string, category *string, tagsJSON *string) error {
	now := FormatISO(time.Now().UTC())
	_, err := s.DB.Exec(
		`UPDATE "streamers" SET "last_checked" = ?, "last_live" = ?, "current_broadcast_title" = ?, "current_broadcast_category" = ?, "current_broadcast_tags" = ? WHERE "id" = ?`,
		now, now, title, category, tagsJSON, id,
	)
	return err
}

func (s *Store) UpdateStreamerOfflineChecked(id string) error {
	now := FormatISO(time.Now().UTC())
	_, err := s.DB.Exec(
		`UPDATE "streamers" SET "last_checked" = ?, "is_recording" = 0, "current_broadcast_title" = NULL, "current_broadcast_category" = NULL, "current_broadcast_tags" = NULL WHERE "id" = ?`,
		now, id,
	)
	return err
}

func (s *Store) MarkStreamerRecording(id string, title string, category *string, tagsJSON *string, pid int) error {
	_, err := s.DB.Exec(
		`UPDATE "streamers" SET "is_recording" = 1, "current_broadcast_title" = ?, "current_broadcast_category" = ?, "current_broadcast_tags" = ?, "process_id" = ? WHERE "id" = ?`,
		title, category, tagsJSON, pid, id,
	)
	return err
}

// --- Recordings ---

const recordingSelectCols = `"id", "streamer_id", "user_id", "filename", "title", "resolution",
	"created_at", "youtube_status", "youtube_video_id", "is_recording", "file_hash"`

func scanRecording(rs rowScanner) (*Recording, error) {
	var (
		r           Recording
		streamerID  sql.NullString
		userID      sql.NullString
		title       sql.NullString
		resolution  sql.NullString
		createdAt   FlexTime
		ytStatus    sql.NullString
		ytVideoID   sql.NullString
		isRecording FlexBool
		fileHash    sql.NullString
	)
	err := rs.Scan(
		&r.ID, &streamerID, &userID, &r.Filename, &title, &resolution,
		&createdAt, &ytStatus, &ytVideoID, &isRecording, &fileHash,
	)
	if err != nil {
		return nil, err
	}
	r.StreamerID = nullStrPtr(streamerID)
	r.UserID = nullStrPtr(userID)
	r.Title = nullStrPtr(title)
	r.Resolution = nullStrPtr(resolution)
	r.CreatedAt = flexTimePtr(createdAt)
	r.YoutubeStatus = nullStrPtr(ytStatus)
	r.YoutubeVideoID = nullStrPtr(ytVideoID)
	r.IsRecording = isRecording.Valid && isRecording.Bool
	r.FileHash = nullStrPtr(fileHash)
	return &r, nil
}

func (s *Store) ResetOrphanRecordings() error {
	_, err := s.DB.Exec(`UPDATE "recording" SET "is_recording" = 0 WHERE "is_recording" = 1`)
	return err
}

func (s *Store) CreateRecording(streamerID *string, userID string, filename, title string, isRecording bool) (*Recording, error) {
	id := uuid.NewString()
	now := FormatISO(time.Now().UTC())
	_, err := s.DB.Exec(
		`INSERT INTO "recording" ("id", "streamer_id", "user_id", "filename", "title", "is_recording", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, streamerID, userID, filename, title, isRecording, now,
	)
	if err != nil {
		return nil, err
	}
	return s.GetRecordingByID(id)
}

func (s *Store) GetRecordingByID(id string) (*Recording, error) {
	row := s.DB.QueryRow(`SELECT `+recordingSelectCols+` FROM "recording" WHERE "id" = ?`, id)
	r, err := scanRecording(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return r, err
}

func (s *Store) ListRecordings(userID string, isAdmin bool) ([]Recording, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if isAdmin {
		rows, err = s.DB.Query(`SELECT ` + recordingSelectCols + ` FROM "recording"`)
	} else {
		rows, err = s.DB.Query(`SELECT `+recordingSelectCols+` FROM "recording" WHERE "user_id" = ?`, userID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Recording
	for rows.Next() {
		r, err := scanRecording(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *r)
	}
	return list, rows.Err()
}

func (s *Store) FindDuplicateRecordingByHash(userID, fileHash string) (*Recording, error) {
	row := s.DB.QueryRow(
		`SELECT `+recordingSelectCols+` FROM "recording" WHERE "user_id" = ? AND "file_hash" = ? AND "youtube_status" IN ('UPLOADED', 'UPLOADING') LIMIT 1`,
		userID, fileHash,
	)
	r, err := scanRecording(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return r, err
}

func (s *Store) UpdateRecordingResolution(id, resolution string) error {
	_, err := s.DB.Exec(`UPDATE "recording" SET "resolution" = ? WHERE "id" = ?`, resolution, id)
	return err
}

func (s *Store) UpdateRecordingFilenameAndDone(id, filename string) error {
	_, err := s.DB.Exec(`UPDATE "recording" SET "filename" = ?, "is_recording" = 0 WHERE "id" = ?`, filename, id)
	return err
}

func (s *Store) UpdateRecordingIsRecording(id string, isRecording bool) error {
	_, err := s.DB.Exec(`UPDATE "recording" SET "is_recording" = ? WHERE "id" = ?`, isRecording, id)
	return err
}

func (s *Store) UpdateRecordingYoutubeStatus(id, status string, videoID *string, fileHash *string) error {
	if videoID != nil && fileHash != nil {
		_, err := s.DB.Exec(`UPDATE "recording" SET "youtube_status" = ?, "youtube_video_id" = ?, "file_hash" = ? WHERE "id" = ?`, status, *videoID, *fileHash, id)
		return err
	}
	if videoID != nil {
		_, err := s.DB.Exec(`UPDATE "recording" SET "youtube_status" = ?, "youtube_video_id" = ? WHERE "id" = ?`, status, *videoID, id)
		return err
	}
	if fileHash != nil && *fileHash != "" {
		_, err := s.DB.Exec(`UPDATE "recording" SET "youtube_status" = ?, "file_hash" = ? WHERE "id" = ?`, status, *fileHash, id)
		return err
	}
	_, err := s.DB.Exec(`UPDATE "recording" SET "youtube_status" = ? WHERE "id" = ?`, status, id)
	return err
}

func (s *Store) DeleteRecordingByID(id string) error {
	_, err := s.DB.Exec(`DELETE FROM "recording" WHERE "id" = ?`, id)
	return err
}

func (s *Store) DeleteRecordingByUserAndFilename(userID, filename string) error {
	_, err := s.DB.Exec(`DELETE FROM "recording" WHERE "user_id" = ? AND "filename" = ?`, userID, filename)
	return err
}
