package notify

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/k-atusa/zkzzk/backend/db"
)

// Embed represents a Discord webhook rich embed payload.
type Embed struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Color       int    `json:"color"`
	Timestamp   string `json:"timestamp"`
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

// SendDiscordWebhook posts a notification to the user's configured Discord webhook URL (best effort).
func SendDiscordWebhook(store *db.Store, userID string, embed Embed) {
	if userID == "" || store == nil {
		return
	}
	user, err := store.GetUserByID(userID)
	if err != nil || user == nil || user.DiscordWebhookURL == nil || *user.DiscordWebhookURL == "" {
		return
	}

	if embed.Timestamp == "" {
		embed.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	var payload any
	if user.DiscordWebhookUseEmbed {
		payload = map[string]any{
			"embeds": []Embed{embed},
		}
	} else {
		title := embed.Title
		if title == "" {
			title = "알림"
		}
		payload = map[string]string{
			"content": "**" + title + "**\n" + embed.Description,
		}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, *user.DiscordWebhookURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}
