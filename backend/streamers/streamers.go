package streamers

import (
	"net/http"
	"strings"

	"github.com/k-atusa/zkzzk/backend/auth"
	"github.com/k-atusa/zkzzk/backend/chzzk"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/httpx"
	"github.com/k-atusa/zkzzk/backend/tasks"
)

// Service handles HTTP requests for managing monitored Chzzk streamers.
type Service struct {
	store *db.Store
	tasks *tasks.Service
}

// NewService constructs a Streamers Service.
func NewService(store *db.Store, tasksSvc *tasks.Service) *Service {
	return &Service{
		store: store,
		tasks: tasksSvc,
	}
}

func (s *Service) HandleList(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	list, err := s.store.ListStreamers(user.ID, user.IsAdmin)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

func (s *Service) HandleFollowing(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user.NidAut == nil || *user.NidAut == "" || user.NidSes == nil || *user.NidSes == "" {
		httpx.WriteError(w, http.StatusBadRequest, "쿠키가 설정되지 않았습니다. 설정에서 치지직 쿠키를 먼저 설정해주세요.")
		return
	}

	list, err := chzzk.GetFollowedStreamers(*user.NidAut, *user.NidSes)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

func (s *Service) HandleAdd(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	var body struct {
		ChannelURL string `json:"channel_url"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	channelURL := strings.TrimSpace(body.ChannelURL)
	channelID := chzzk.ExtractChannelID(channelURL)
	if channelID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "올바른 치지직 URL이 아닙니다.")
		return
	}

	detail, err := chzzk.GetLiveDetail(channelID, "", "")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "채널 확인 중 오류가 발생했습니다.")
		return
	}
	if detail.Code != 200 {
		httpx.WriteError(w, http.StatusBadRequest, "치지직 이용 약관을 위반하여 정지된 채널입니다.")
		return
	}

	nickname := detail.Channel.ChannelName
	if nickname == "" {
		httpx.WriteError(w, http.StatusBadRequest, "채널 정보를 가져올 수 없습니다.")
		return
	}

	existing, err := s.store.GetStreamerByUserAndURL(user.ID, channelURL)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if existing != nil {
		httpx.WriteError(w, http.StatusBadRequest, "이미 등록된 채널입니다.")
		return
	}

	streamer, err := s.store.CreateStreamer(channelURL, nickname, user.ID)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "스트리머 추가에 실패했습니다.")
		return
	}

	go s.tasks.CheckStreamer(*streamer)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"status":   "success",
		"message":  "스트리머가 추가되었습니다.",
		"streamer": streamer,
	})
}

func (s *Service) authorizeStreamer(w http.ResponseWriter, r *http.Request, id string) (*db.Streamer, *db.User, bool) {
	user := auth.UserFromContext(r.Context())
	st, err := s.store.GetStreamerByID(id)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "Database error")
		return nil, nil, false
	}
	if st == nil {
		httpx.WriteError(w, http.StatusNotFound, "스트리머를 찾을 수 없습니다.")
		return nil, nil, false
	}
	isOwner := st.UserID != nil && *st.UserID == user.ID
	if !isOwner && !user.IsAdmin {
		httpx.WriteError(w, http.StatusForbidden, "권한이 없습니다.")
		return nil, nil, false
	}
	return st, user, true
}

func (s *Service) HandleRemove(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, _, ok := s.authorizeStreamer(w, r, id)
	if !ok {
		return
	}

	if st.IsRecording {
		s.tasks.KillStreamerProcess(st.ID, st.ProcessID)
	}

	if err := s.store.DeleteStreamer(st.ID); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "스트리머 삭제에 실패했습니다.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Service) HandleStopRecording(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, _, ok := s.authorizeStreamer(w, r, id)
	if !ok {
		return
	}

	if st.IsRecording {
		s.tasks.KillStreamerProcess(st.ID, st.ProcessID)
	}

	if err := s.store.ResetStreamerState(st.ID, true, true); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "녹화 중지에 실패했습니다.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Service) HandleResumeRecording(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, _, ok := s.authorizeStreamer(w, r, id)
	if !ok {
		return
	}

	updated, err := s.store.SetStreamerPaused(st.ID, false)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "녹화 재개에 실패했습니다.")
		return
	}
	if updated != nil {
		go s.tasks.CheckStreamer(*updated)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Service) HandleSetCookies(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StreamerID   string  `json:"streamer_id"`
		CookieUserID *string `json:"cookie_user_id"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	st, _, ok := s.authorizeStreamer(w, r, body.StreamerID)
	if !ok {
		return
	}

	if body.CookieUserID != nil && *body.CookieUserID != "" {
		cu, err := s.store.GetUserByID(*body.CookieUserID)
		if err != nil || cu == nil {
			httpx.WriteError(w, http.StatusBadRequest, "쿠키 사용자를 찾을 수 없습니다.")
			return
		}
		if cu.NidAut == nil || *cu.NidAut == "" || cu.NidSes == nil || *cu.NidSes == "" {
			httpx.WriteError(w, http.StatusBadRequest, "해당 사용자의 쿠키가 설정되지 않았습니다.")
			return
		}
	}

	if err := s.store.SetStreamerCookieUser(st.ID, body.CookieUserID); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "쿠키 설정에 실패했습니다.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "success"})
}
