package chzzk

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	channelURLRe = regexp.MustCompile(`chzzk\.naver\.com/([a-f0-9]{32})`)
	vodURLRe     = regexp.MustCompile(`https?://chzzk\.naver\.com/video/(\d+)`)
)

var httpClient = &http.Client{Timeout: 15 * time.Second}

// ExtractChannelID extracts the 32-character hex channel ID from a Chzzk URL.
func ExtractChannelID(url string) string {
	m := channelURLRe.FindStringSubmatch(url)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

// ExtractVideoNo extracts the numeric video ID from a Chzzk VOD URL.
func ExtractVideoNo(url string) string {
	m := vodURLRe.FindStringSubmatch(url)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

func applyNaverCookieHeaders(req *http.Request, nidAut, nidSes string) {
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "ko-KR,ko;q=0.8")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	req.Header.Set("Origin", "https://chzzk.naver.com")
	req.Header.Set("Referer", "https://chzzk.naver.com/")
	req.Header.Set("front-client-platform-type", "PC")
	req.Header.Set("front-client-product-type", "web")
	req.Header.Set("if-modified-since", "Mon, 26 Jul 1997 05:00:00 GMT")
	if nidAut != "" && nidSes != "" {
		req.Header.Set("Cookie", fmt.Sprintf("NID_AUT=%s; NID_SES=%s", nidAut, nidSes))
	}
}

// LiveDetail holds the relevant fields from Chzzk's live-detail API.
type LiveDetail struct {
	Code    int
	Status  string
	Title   string
	CatVal  string
	Tags    []string
	Channel struct {
		ChannelName string `json:"channelName"`
	}
}

// GetLiveDetail fetches channel live status and metadata.
func GetLiveDetail(channelID, nidAut, nidSes string) (*LiveDetail, error) {
	url := fmt.Sprintf("https://api.chzzk.naver.com/service/v3/channels/%s/live-detail", channelID)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
	req.Header.Set("Origin", "https://chzzk.naver.com")
	req.Header.Set("Referer", "https://chzzk.naver.com/")
	if nidAut != "" && nidSes != "" {
		req.Header.Set("Cookie", fmt.Sprintf("NID_AUT=%s; NID_SES=%s", nidAut, nidSes))
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("chzzk live-detail status %d", resp.StatusCode)
	}

	var raw struct {
		Code    int `json:"code"`
		Content *struct {
			Status            string   `json:"status"`
			LiveTitle         string   `json:"liveTitle"`
			LiveCategoryValue string   `json:"liveCategoryValue"`
			Tags              []string `json:"tags"`
			Channel           struct {
				ChannelName string `json:"channelName"`
			} `json:"channel"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	out := &LiveDetail{Code: raw.Code}
	if raw.Content != nil {
		out.Status = raw.Content.Status
		out.Title = raw.Content.LiveTitle
		out.CatVal = raw.Content.LiveCategoryValue
		out.Tags = raw.Content.Tags
		out.Channel.ChannelName = raw.Content.Channel.ChannelName
	}
	return out, nil
}

// VerifyCookies validates Naver NID_AUT/NID_SES cookies and fetches the user's Chzzk nickname.
func VerifyCookies(nidAut, nidSes string) (bool, *string) {
	req, err := http.NewRequest(http.MethodGet, "https://api.chzzk.naver.com/service/v1/channels/followings?page=0&size=1&sortType=FOLLOW", nil)
	if err != nil {
		return false, nil
	}
	applyNaverCookieHeaders(req, nidAut, nidSes)

	resp, err := httpClient.Do(req)
	if err != nil {
		return false, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, nil
	}
	var followRes struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&followRes); err != nil || followRes.Code != 200 {
		return false, nil
	}

	userReq, err := http.NewRequest(http.MethodGet, "https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus", nil)
	if err != nil {
		return true, nil
	}
	applyNaverCookieHeaders(userReq, nidAut, nidSes)
	userResp, err := httpClient.Do(userReq)
	if err != nil {
		return true, nil
	}
	defer userResp.Body.Close()

	var userRes struct {
		Content *struct {
			Nickname *string `json:"nickname"`
		} `json:"content"`
	}
	if err := json.NewDecoder(userResp.Body).Decode(&userRes); err == nil && userRes.Content != nil {
		return true, userRes.Content.Nickname
	}
	return true, nil
}

// FollowedStreamer matches the frontend's /api/streamers/following response item.
type FollowedStreamer struct {
	ChannelID           string   `json:"channelId"`
	ChannelName         string   `json:"channelName"`
	ChannelImageURL     string   `json:"channelImageUrl"`
	VerifiedMark        bool     `json:"verifiedMark"`
	OpenLive            bool     `json:"openLive"`
	LiveTitle           *string  `json:"liveTitle"`
	ConcurrentUserCount int      `json:"concurrentUserCount"`
	LiveCategoryValue   *string  `json:"liveCategoryValue"`
	Tags                []string `json:"tags"`
	ChannelURL          string   `json:"channel_url"`
}

// GetFollowedStreamers returns up to 505 followed channels for the given Naver cookies.
func GetFollowedStreamers(nidAut, nidSes string) ([]FollowedStreamer, error) {
	req, err := http.NewRequest(http.MethodGet, "https://api.chzzk.naver.com/service/v1/channels/followings?page=0&size=505&sortType=FOLLOW", nil)
	if err != nil {
		return nil, err
	}
	applyNaverCookieHeaders(req, nidAut, nidSes)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var raw struct {
		Code    int `json:"code"`
		Content *struct {
			FollowingList []struct {
				ChannelID string `json:"channelId"`
				Channel   struct {
					ChannelName     string `json:"channelName"`
					ChannelImageURL string `json:"channelImageUrl"`
					VerifiedMark    bool   `json:"verifiedMark"`
				} `json:"channel"`
				Streamer struct {
					OpenLive bool `json:"openLive"`
				} `json:"streamer"`
				LiveInfo *struct {
					LiveTitle           *string  `json:"liveTitle"`
					ConcurrentUserCount int      `json:"concurrentUserCount"`
					LiveCategoryValue   *string  `json:"liveCategoryValue"`
					Tags                []string `json:"tags"`
				} `json:"liveInfo"`
			} `json:"followingList"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil || raw.Code != 200 || raw.Content == nil || raw.Content.FollowingList == nil {
		return nil, errors.New("쿠키가 유효하지 않거나 팔로우 목록을 가져올 수 없습니다.")
	}

	result := make([]FollowedStreamer, 0, len(raw.Content.FollowingList))
	for _, item := range raw.Content.FollowingList {
		fs := FollowedStreamer{
			ChannelID:       item.ChannelID,
			ChannelName:     item.Channel.ChannelName,
			ChannelImageURL: item.Channel.ChannelImageURL,
			VerifiedMark:    item.Channel.VerifiedMark,
			OpenLive:        item.Streamer.OpenLive,
			Tags:            []string{},
			ChannelURL:      "https://chzzk.naver.com/" + item.ChannelID,
		}
		if item.LiveInfo != nil {
			fs.LiveTitle = item.LiveInfo.LiveTitle
			fs.ConcurrentUserCount = item.LiveInfo.ConcurrentUserCount
			fs.LiveCategoryValue = item.LiveInfo.LiveCategoryValue
			if item.LiveInfo.Tags != nil {
				fs.Tags = item.LiveInfo.Tags
			}
		}
		result = append(result, fs)
	}
	return result, nil
}

// VodVideoInfo matches the `video_info` field expected by frontend Vod page.
type VodVideoInfo struct {
	VideoID        string   `json:"video_id"`
	InKey          string   `json:"in_key"`
	Title          string   `json:"title"`
	Author         string   `json:"author"`
	Category       string   `json:"category"`
	Tags           []string `json:"tags"`
	RawPublishDate string   `json:"raw_publish_date"`
}

// VodResolution matches each resolution entry expected by frontend Vod page.
type VodResolution struct {
	Resolution      string  `json:"resolution"`
	Width           int     `json:"width"`
	Height          int     `json:"height"`
	Bandwidth       int     `json:"bandwidth"`
	Quality         string  `json:"quality"`
	DownloadURL     string  `json:"download_url"`
	DownloadType    string  `json:"download_type"`
	EstimatedSizeMB float64 `json:"estimated_size_mb"`
}

// VodInfoResponse matches /api/vod/get_vod_info.
type VodInfoResponse struct {
	VideoInfo         VodVideoInfo    `json:"video_info"`
	Resolutions       []VodResolution `json:"resolutions"`
	DefaultResolution string          `json:"default_resolution"`
}

type vodAPIResp struct {
	Code    int `json:"code"`
	Content struct {
		VideoID                string          `json:"videoId"`
		InKey                  string          `json:"inKey"`
		VideoTitle             string          `json:"videoTitle"`
		VideoType              string          `json:"videoType"`
		VideoCategory          string          `json:"videoCategory"`
		Tags                   []string        `json:"tags"`
		PublishDate            string          `json:"publishDate"`
		LiveRewindPlaybackJSON json.RawMessage `json:"liveRewindPlaybackJson"`
		Channel                struct {
			ChannelName string `json:"channelName"`
		} `json:"channel"`
	} `json:"content"`
}

// GetVodInfo retrieves metadata and available stream resolutions for a Chzzk VOD URL.
func GetVodInfo(videoNo, nidAut, nidSes string) (*VodInfoResponse, error) {
	apiURL := fmt.Sprintf("https://api.chzzk.naver.com/service/v2/videos/%s", videoNo)
	fetch := func(withCookie bool) (int, *vodAPIResp, error) {
		req, err := http.NewRequest(http.MethodGet, apiURL, nil)
		if err != nil {
			return 0, nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3")
		if withCookie && nidAut != "" && nidSes != "" {
			req.Header.Set("Cookie", fmt.Sprintf("NID_AUT=%s; NID_SES=%s", nidAut, nidSes))
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			return resp.StatusCode, nil, nil
		}
		var parsed vodAPIResp
		if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
			return resp.StatusCode, nil, err
		}
		return resp.StatusCode, &parsed, nil
	}

	status, data, err := fetch(false)
	if err != nil {
		return nil, errors.New("VOD 정보 가져오기 중 오류가 발생했습니다.")
	}
	if status == http.StatusNotFound || data == nil {
		return nil, errors.New("VOD 정보를 가져올 수 없습니다.")
	}
	if data.Content.VideoType == "UPLOAD" {
		return nil, errors.New("직접 업로드된 영상 다운로드 기능은 준비중입니다.")
	}

	hasRewind := len(data.Content.LiveRewindPlaybackJSON) > 0 && string(data.Content.LiveRewindPlaybackJSON) != "null"
	if (data.Content.VideoID == "" || (data.Content.InKey == "" && !hasRewind)) && nidAut != "" && nidSes != "" {
		if status2, data2, err2 := fetch(true); err2 == nil && status2 != http.StatusNotFound && data2 != nil {
			data = data2
			hasRewind = len(data.Content.LiveRewindPlaybackJSON) > 0 && string(data.Content.LiveRewindPlaybackJSON) != "null"
		}
	}

	if data.Content.VideoID == "" || (data.Content.InKey == "" && !hasRewind) {
		return nil, errors.New("인증 실패 혹은 정보 부족")
	}

	resolutions, err := getVodStreamURLs(data.Content.VideoID, data.Content.InKey, data.Content.LiveRewindPlaybackJSON)
	if err != nil || len(resolutions) == 0 {
		return nil, errors.New("스트림 URL을 가져올 수 없습니다.")
	}

	sort.Slice(resolutions, func(i, j int) bool {
		return resolutions[i].Height > resolutions[j].Height
	})

	defaultRes := "1080p"
	if len(resolutions) > 0 {
		defaultRes = resolutions[0].Resolution
	}
	tags := data.Content.Tags
	if tags == nil {
		tags = []string{}
	}

	return &VodInfoResponse{
		VideoInfo: VodVideoInfo{
			VideoID:        data.Content.VideoID,
			InKey:          data.Content.InKey,
			Title:          data.Content.VideoTitle,
			Author:         data.Content.Channel.ChannelName,
			Category:       data.Content.VideoCategory,
			Tags:           tags,
			RawPublishDate: data.Content.PublishDate,
		},
		Resolutions:       resolutions,
		DefaultResolution: defaultRes,
	}, nil
}

func getVodStreamURLs(videoID, inKey string, rewindRaw json.RawMessage) ([]VodResolution, error) {
	if inKey == "" && len(rewindRaw) > 0 && string(rewindRaw) != "null" {
		var playbackStr string
		var jsonBytes []byte
		if rewindRaw[0] == '"' {
			if err := json.Unmarshal(rewindRaw, &playbackStr); err == nil {
				jsonBytes = []byte(playbackStr)
			}
		} else {
			jsonBytes = rewindRaw
		}
		var playback struct {
			Media []struct {
				Protocol      string `json:"protocol"`
				Path          string `json:"path"`
				EncodingTrack []struct {
					EncodingTrackID string `json:"encodingTrackId"`
					VideoWidth      int    `json:"videoWidth"`
					VideoHeight     int    `json:"videoHeight"`
					VideoBitRate    int    `json:"videoBitRate"`
					Path            string `json:"path"`
				} `json:"encodingTrack"`
			} `json:"media"`
		}
		if err := json.Unmarshal(jsonBytes, &playback); err == nil && len(playback.Media) > 0 {
			seen := make(map[string]VodResolution)
			for _, m := range playback.Media {
				dlType := "dash"
				if m.Protocol == "HLS" {
					dlType = "m3u8"
				}
				if len(m.EncodingTrack) > 0 {
					for _, tr := range m.EncodingTrack {
						q := tr.EncodingTrackID
						if q == "" {
							q = fmt.Sprintf("%dp", tr.VideoHeight)
						}
						dlURL := tr.Path
						if dlURL == "" {
							dlURL = m.Path
						}
						est := 0.0
						if tr.VideoBitRate > 0 {
							est = math.Round(((float64(tr.VideoBitRate)*3600/8)/1024/1024)*10) / 10
						}
						seen[q] = VodResolution{
							Resolution:      q,
							Width:           tr.VideoWidth,
							Height:          tr.VideoHeight,
							Bandwidth:       tr.VideoBitRate,
							Quality:         q,
							DownloadURL:     dlURL,
							DownloadType:    dlType,
							EstimatedSizeMB: est,
						}
					}
				} else {
					seen["1080p"] = VodResolution{
						Resolution:   "1080p",
						Width:        1920,
						Height:       1080,
						Quality:      "1080p",
						DownloadURL:  m.Path,
						DownloadType: "m3u8",
					}
				}
			}
			out := make([]VodResolution, 0, len(seen))
			for _, v := range seen {
				out = append(out, v)
			}
			if len(out) > 0 {
				return out, nil
			}
		}
	}

	if inKey == "" {
		return nil, errors.New("missing inKey")
	}

	vodURL := fmt.Sprintf("https://apis.naver.com/neonplayer/vodplay/v2/playback/%s?key=%s", videoID, inKey)
	req, err := http.NewRequest(http.MethodGet, vodURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/dash+xml")
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var mpd struct {
		Period []struct {
			AdaptationSet []struct {
				MimeType       string `xml:"mimeType,attr"`
				Representation []struct {
					Width     string   `xml:"width,attr"`
					Height    string   `xml:"height,attr"`
					Bandwidth string   `xml:"bandwidth,attr"`
					BaseURL   []string `xml:"BaseURL"`
				} `xml:"Representation"`
			} `xml:"AdaptationSet"`
		} `xml:"Period"`
	}
	if err := xml.Unmarshal(body, &mpd); err != nil {
		return nil, err
	}

	seen := make(map[string]VodResolution)
	for _, p := range mpd.Period {
		for _, as := range p.AdaptationSet {
			if !strings.HasPrefix(as.MimeType, "video") {
				continue
			}
			for _, rep := range as.Representation {
				if rep.Width == "" || rep.Height == "" || len(rep.BaseURL) == 0 {
					continue
				}
				if !strings.Contains(rep.BaseURL[0], "pstatic.net") {
					continue
				}
				w, _ := strconv.Atoi(rep.Width)
				h, _ := strconv.Atoi(rep.Height)
				bw, _ := strconv.Atoi(rep.Bandwidth)
				quality := fmt.Sprintf("%dp", h)
				manifestURL := fmt.Sprintf("https://apis.naver.com/neonplayer/vodplay/v2/playback/%s?key=%s&quality=%s", videoID, inKey, quality)
				est := 0.0
				if bw > 0 {
					est = math.Round(((float64(bw)*3600/8)/1024/1024)*10) / 10
				}
				seen[quality] = VodResolution{
					Resolution:      quality,
					Width:           w,
					Height:          h,
					Bandwidth:       bw,
					Quality:         quality,
					DownloadURL:     manifestURL,
					DownloadType:    "dash",
					EstimatedSizeMB: est,
				}
			}
		}
	}

	out := make([]VodResolution, 0, len(seen))
	for _, v := range seen {
		out = append(out, v)
	}
	return out, nil
}
