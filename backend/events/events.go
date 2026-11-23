package events

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// YoutubeUploadPayload mirrors the payload sent on /api/events/youtube.
type YoutubeUploadPayload struct {
	RecordingID string `json:"recordingId"`
	VideoID     string `json:"video_id"`
	IsDeleted   bool   `json:"isDeleted"`
}

// VodProgressPayload mirrors the payload sent on /api/events/vod.
type VodProgressPayload struct {
	RecordingID string `json:"recordingId"`
	Progress    string `json:"progress"`
}

type sseEnvelope struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

type channelBroker struct {
	mu      sync.RWMutex
	clients map[chan []byte]struct{}
}

func newChannelBroker() *channelBroker {
	return &channelBroker{
		clients: make(map[chan []byte]struct{}),
	}
}

func (b *channelBroker) subscribe() chan []byte {
	ch := make(chan []byte, 32)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *channelBroker) unsubscribe(ch chan []byte) {
	b.mu.Lock()
	delete(b.clients, ch)
	close(ch)
	b.mu.Unlock()
}

func (b *channelBroker) publish(eventType string, payload any) {
	data, err := json.Marshal(sseEnvelope{
		Type:    eventType,
		Payload: payload,
	})
	if err != nil {
		return
	}
	b.mu.RLock()
	for ch := range b.clients {
		select {
		case ch <- data:
		default:
			// Drop slow client backlog rather than blocking background workers.
		}
	}
	b.mu.RUnlock()
}

func (b *channelBroker) serveHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch := b.subscribe()
	defer b.unsubscribe(ch)

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, open := <-ch:
			if !open {
				return
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-keepalive.C:
			_, _ = fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// Broker broadcasts YouTube upload completion and VOD download progress events via SSE.
type Broker struct {
	youtube *channelBroker
	vod     *channelBroker
}

// NewBroker creates an initialized SSE Broker.
func NewBroker() *Broker {
	return &Broker{
		youtube: newChannelBroker(),
		vod:     newChannelBroker(),
	}
}

// EmitYoutubeUploadComplete pushes a YOUTUBE_UPLOAD_COMPLETE event to connected SSE listeners.
func (b *Broker) EmitYoutubeUploadComplete(p YoutubeUploadPayload) {
	b.youtube.publish("YOUTUBE_UPLOAD_COMPLETE", p)
}

// EmitVodProgress pushes a VOD_DOWNLOAD_PROGRESS event to connected SSE listeners.
func (b *Broker) EmitVodProgress(p VodProgressPayload) {
	b.vod.publish("VOD_DOWNLOAD_PROGRESS", p)
}

// HandleYoutubeSSE handles GET /api/events/youtube.
func (b *Broker) HandleYoutubeSSE(w http.ResponseWriter, r *http.Request) {
	b.youtube.serveHTTP(w, r)
}

// HandleVodSSE handles GET /api/events/vod.
func (b *Broker) HandleVodSSE(w http.ResponseWriter, r *http.Request) {
	b.vod.serveHTTP(w, r)
}
