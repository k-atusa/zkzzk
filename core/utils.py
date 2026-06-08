import os
import re
import json
import requests
import xml.etree.ElementTree as ET
from urllib.parse import urljoin
from flask import g

def extract_channel_id(url):
    pattern = r'chzzk\.naver\.com/([a-f0-9]{32})'
    match = re.search(pattern, url)
    if match:
        return match.group(1)
    return None

def get_channel_info(channel_id):
    try:
        url = f'https://api.chzzk.naver.com/service/v3/channels/{channel_id}/live-detail'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'Origin': 'https://chzzk.naver.com',
            'Referer': 'https://chzzk.naver.com/'
        }
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        if data.get('code') == 200 and data.get('content'):
            return data['content']['channel']['channelName']
        return None
    except Exception as e:
        print(f"Error fetching channel info: {e}")
        return None

def clean_filename(filename):
    cleaned_filename = re.sub(r'[♥♡ღ⭐㉦✧》《♠♦❤️♣✿ꈍᴗ\/@!~*\[\]\#\$\%\^\&\(\)\-\_\=\+\<\>\?\;\:\'\"]', '', filename)
    return cleaned_filename

def can_access_recording_path(filename):
    normalized = os.path.normpath(filename).replace('\\', '/')
    if normalized.startswith('../') or normalized.startswith('/'):
        return False
    if not getattr(g, 'user', None):
        return False
    if g.user.is_admin:
        return True
    return normalized.startswith(f"{g.user.username}/")

def get_vod_info(video_no):
    api_url = f"https://api.chzzk.naver.com/service/v2/videos/{video_no}"
    print(f"[VOD INFO] API URL: {api_url}")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
    }
    
    try:
        response = requests.get(api_url, headers=headers)
        response.raise_for_status()
        
        if response.status_code == 404:
            print(f"[VOD INFO] 404 Not Found for video_no: {video_no}")
            return None
            
        content = response.json().get('content', {})
        video_id = content.get('videoId')
        in_key = content.get('inKey')
        live_rewind_playback_json = content.get('liveRewindPlaybackJson')
        
        print(f"[VOD INFO] Video ID: {video_id}, In Key: {in_key}")
        
        if video_id is None or (in_key is None and not live_rewind_playback_json):
            if getattr(g, 'user', None) and getattr(g.user, 'nid_aut', None) and getattr(g.user, 'nid_ses', None):
                print(f"[VOD INFO] Using cookies for authentication")
                cookies = {
                    'NID_AUT': g.user.nid_aut,
                    'NID_SES': g.user.nid_ses
                }
                response = requests.get(api_url, cookies=cookies, headers=headers)
                response.raise_for_status()
                content = response.json().get('content', {})
                video_id = content.get('videoId')
                in_key = content.get('inKey')
                live_rewind_playback_json = content.get('liveRewindPlaybackJson')
                print(f"[VOD INFO] After auth - Video ID: {video_id}, In Key: {in_key}")
        
        if video_id and (in_key or live_rewind_playback_json):
            publish_date = content.get('publishDate')
            formatted_publish_date = None
            if publish_date:
                try:
                    from datetime import datetime
                    publish_datetime = datetime.fromisoformat(publish_date.replace('Z', '+00:00'))
                    formatted_publish_date = publish_datetime.astimezone(datetime.now().tzinfo).strftime('%Y-%m-%d %H:%M')
                    print(f"[VOD INFO] Publish date: {formatted_publish_date}")
                except Exception as e:
                    print(f"[VOD INFO] Error parsing publish date: {e}")
            
            vod_info = {
                'video_id': video_id,
                'in_key': in_key,
                'title': content.get('videoTitle'),
                'author': content.get('channel', {}).get('channelName'),
                'category': content.get('videoCategory'),
                'tags': content.get('tags', []),
                'publish_date': formatted_publish_date,
                'raw_publish_date': publish_date,
                'live_rewind_playback_json': live_rewind_playback_json
            }
            print(f"[VOD INFO] Successfully retrieved VOD info: {vod_info['title']}")
            return vod_info
        
        print(f"[VOD INFO] Failed to get video_id or in_key")
        return None
    except Exception as e:
        print(f"Error fetching VOD info: {e}")
        return None

def get_vod_stream_urls(video_id, in_key, live_rewind_playback_json=None):
    if not in_key and live_rewind_playback_json:
        print("[VOD STREAM] inKey missing, trying liveRewindPlaybackJson m3u8 flow...")
        try:
            if isinstance(live_rewind_playback_json, str):
                playback_json = json.loads(live_rewind_playback_json)
            else:
                playback_json = live_rewind_playback_json

            media = playback_json.get('media', [])
            if not media:
                print("[VOD STREAM] No media array in liveRewindPlaybackJson")
                return None

            master_m3u8_url = media[0].get('path')
            encoding_track = media[0].get('encodingTrack', [])
            if not master_m3u8_url:
                print("[VOD STREAM] Missing master m3u8 path in liveRewindPlaybackJson")
                return None

            m3u8_headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
                'Origin': 'https://chzzk.naver.com',
                'Referer': 'https://chzzk.naver.com/'
            }
            master_resp = requests.get(master_m3u8_url, headers=m3u8_headers)
            master_resp.raise_for_status()
            lines = [line.strip() for line in master_resp.text.splitlines() if line.strip()]

            stream_urls = {}

            track_map = {}
            for track in encoding_track:
                width = track.get('videoWidth')
                height = track.get('videoHeight')
                if width and height:
                    track_map[f"{int(width)}x{int(height)}"] = {
                        'bandwidth': int(track.get('encodingRate') or 0)
                    }

            for i, line in enumerate(lines):
                if not line.startswith('#EXT-X-STREAM-INF:'):
                    continue

                resolution_match = re.search(r'RESOLUTION=(\d+)x(\d+)', line)
                bandwidth_match = re.search(r'BANDWIDTH=(\d+)', line)
                if not resolution_match:
                    continue

                width = int(resolution_match.group(1))
                height = int(resolution_match.group(2))
                resolution = f"{width}x{height}"

                if i + 1 >= len(lines):
                    continue
                variant_path = lines[i + 1]
                if variant_path.startswith('#'):
                    continue

                variant_url = urljoin(master_m3u8_url, variant_path)

                if height >= 1080:
                    quality = '1080p'
                elif height >= 720:
                    quality = '720p'
                elif height >= 480:
                    quality = '480p'
                elif height >= 360:
                    quality = '360p'
                else:
                    quality = '240p'

                bandwidth = int(bandwidth_match.group(1)) if bandwidth_match else track_map.get(resolution, {}).get('bandwidth', 0)

                stream_urls[resolution] = {
                    'download_url': variant_url,
                    'width': width,
                    'height': height,
                    'bandwidth': bandwidth,
                    'quality': quality,
                    'download_type': 'm3u8'
                }
                print(f"[VOD STREAM] Added m3u8 URL for {resolution} ({quality}): {variant_url}")

            if stream_urls:
                sorted_urls = dict(sorted(stream_urls.items(), key=lambda x: (x[1]['height'], x[1]['width']), reverse=True))
                print(f"[VOD STREAM] Returning {len(sorted_urls)} m3u8 stream URLs")
                return sorted_urls

            for track in encoding_track:
                width = track.get('videoWidth')
                height = track.get('videoHeight')
                if not width or not height:
                    continue
                width = int(width)
                height = int(height)
                resolution = f"{width}x{height}"
                if height >= 1080:
                    quality = '1080p'
                elif height >= 720:
                    quality = '720p'
                elif height >= 480:
                    quality = '480p'
                elif height >= 360:
                    quality = '360p'
                else:
                    quality = '240p'
                stream_urls[resolution] = {
                    'download_url': master_m3u8_url,
                    'width': width,
                    'height': height,
                    'bandwidth': int(track.get('encodingRate') or 0),
                    'quality': quality,
                    'download_type': 'm3u8'
                }

            if stream_urls:
                sorted_urls = dict(sorted(stream_urls.items(), key=lambda x: (x[1]['height'], x[1]['width']), reverse=True))
                print(f"[VOD STREAM] Returning {len(sorted_urls)} m3u8 fallback stream URLs")
                return sorted_urls

            return None
        except Exception as e:
            print(f"[VOD STREAM] Error in liveRewindPlaybackJson flow: {e}")
            return None

    if not in_key:
        print("[VOD STREAM] Missing both inKey and liveRewindPlaybackJson")
        return None

    vod_url = f"https://apis.naver.com/neonplayer/vodplay/v2/playback/{video_id}?key={in_key}"
    print(f"[VOD STREAM] Requesting stream URLs from: {vod_url}")
    
    try:
        headers = {
            "Accept": "application/dash+xml",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Origin": "https://chzzk.naver.com",
            "Referer": "https://chzzk.naver.com/"
        }
        
        response = requests.get(vod_url, headers=headers)
        response.raise_for_status()
        
        print(f"[VOD STREAM] Response status: {response.status_code}")
        print(f"[VOD STREAM] Response content length: {len(response.text)}")
        
        if len(response.text) < 100:
            print(f"[VOD STREAM] Response too short, content: {response.text[:200]}")
            return None
        
        if response.text.strip().startswith('{'):
            print("[VOD STREAM] Received JSON response, trying to parse...")
            try:
                json_data = response.json()
                print(f"[VOD STREAM] JSON response keys: {list(json_data.keys())}")
                
                if 'baseURL' in json_data:
                    base_url = json_data['baseURL']
                    print(f"[VOD STREAM] Found baseURL in JSON: {base_url}")
                    if "pstatic.net" in base_url:
                        stream_urls = {
                            "1280x720": {
                                'download_url': base_url,
                                'width': 1280,
                                'height': 720,
                                'bandwidth': 2000000,
                                'quality': '720p'
                            }
                        }
                        print(f"[VOD STREAM] Using JSON baseURL: {base_url}")
                        return stream_urls
                
                if 'period' in json_data and 'adaptationSet' in json_data['period'][0]:
                    stream_urls = {}
                    adaptation_sets = json_data['period'][0]['adaptationSet']
                    print(f"[VOD STREAM] Found {len(adaptation_sets)} adaptation sets")
                    for adaptation_set in adaptation_sets:
                        if adaptation_set.get('mimeType', '').startswith('video'):
                            representations = adaptation_set.get('representation', [])
                            print(f"[VOD STREAM] Found {len(representations)} video representations")
                            for rep in representations:
                                width = rep.get('width')
                                height = rep.get('height')
                                bandwidth = rep.get('bandwidth')
                                
                                if width and height:
                                    resolution = f"{width}x{height}"
                                    base_url_list = rep.get('baseURL', [{}])
                                    base_url = base_url_list[0].get('value', '') if base_url_list else ''
                                    
                                    if base_url and "pstatic.net" in base_url:
                                        if int(height) >= 1080:
                                            quality = "1080p"
                                        elif int(height) >= 720:
                                            quality = "720p"
                                        elif int(height) >= 480:
                                            quality = "480p"
                                        elif int(height) >= 360:
                                            quality = "360p"
                                        else:
                                            quality = "240p"
                                        manifest_url = f"https://apis.naver.com/neonplayer/vodplay/v2/playback/{video_id}?key={in_key}&quality={quality}"
                                        stream_urls[resolution] = {
                                            'download_url': manifest_url,
                                            'width': int(width),
                                            'height': int(height),
                                            'bandwidth': int(bandwidth) if bandwidth else 0,
                                            'quality': quality,
                                            'download_type': 'dash'
                                        }
                                        print(f"[VOD STREAM] Added JSON download URL for {resolution} ({quality}): {base_url}")
                    
                    if stream_urls:
                        sorted_urls = dict(sorted(stream_urls.items(), 
                                         key=lambda x: (x[1]['height'], x[1]['width']), 
                                         reverse=True))
                        print(f"[VOD STREAM] Returning {len(sorted_urls)} JSON stream URLs")
                        return sorted_urls
            except Exception as e:
                print(f"[VOD STREAM] JSON parsing error: {e}")
                pass
        
        print("[VOD STREAM] Attempting XML parsing...")
        try:
            root = ET.fromstring(response.text)
        except ET.ParseError as e:
            print(f"[VOD STREAM] XML parsing error: {e}")
            return None
        ns = {"mpd": "urn:mpeg:dash:schema:mpd:2011", "nvod": "urn:naver:vod:2020"}
        
        print(f"[VOD STREAM] XML Root tag: {root.tag}")
        
        all_base_urls = root.findall(".//mpd:BaseURL", namespaces=ns)
        print(f"[VOD STREAM] Found {len(all_base_urls)} BaseURL elements:")
        for i, url in enumerate(all_base_urls):
            print(f"[VOD STREAM]   {i+1}: {url.text}")
        
        stream_urls = {}
        
        adaptation_sets = root.findall(".//mpd:AdaptationSet", namespaces=ns)
        print(f"[VOD STREAM] Found {len(adaptation_sets)} AdaptationSets")
        
        for i, adaptation_set in enumerate(adaptation_sets):
            mime_type = adaptation_set.get('mimeType', '')
            
            if mime_type == 'video/mp4':
                print(f"[VOD STREAM] Processing video/mp4 AdaptationSet {i+1}")
                representations = adaptation_set.findall(".//mpd:Representation", namespaces=ns)
                print(f"[VOD STREAM] Found {len(representations)} representations in AdaptationSet {i+1}")
                
                for j, rep in enumerate(representations):
                    width = rep.get('width')
                    height = rep.get('height')
                    bandwidth = rep.get('bandwidth')
                    
                    if width and height:
                        resolution = f"{width}x{height}"
                        
                        base_url_element = rep.find(".//mpd:BaseURL", namespaces=ns)
                        if base_url_element is not None:
                            base_url = base_url_element.text
                            print(f"[VOD STREAM] Found BaseURL for {resolution}: {base_url}")
                            
                            if "pstatic.net" in base_url:
                                if int(height) >= 1080:
                                    quality = "1080p"
                                elif int(height) >= 720:
                                    quality = "720p"
                                elif int(height) >= 480:
                                    quality = "480p"
                                elif int(height) >= 360:
                                    quality = "360p"
                                else:
                                    quality = "240p"
                                manifest_url = f"https://apis.naver.com/neonplayer/vodplay/v2/playback/{video_id}?key={in_key}&quality={quality}"
                                stream_urls[resolution] = {
                                    'download_url': manifest_url,
                                    'width': int(width),
                                    'height': int(height),
                                    'bandwidth': int(bandwidth) if bandwidth else 0,
                                    'quality': quality,
                                    'download_type': 'dash'
                                }
                                print(f"[VOD STREAM] Added XML download URL for {resolution} ({quality}): {base_url}")
                            else:
                                print(f"[VOD STREAM] BaseURL is not pstatic.net for {resolution}: {base_url}")
                        else:
                            print(f"[VOD STREAM] No BaseURL found for {resolution}")
                    else:
                        print(f"[VOD STREAM] Missing width or height for representation {j}")
            else:
                print(f"[VOD STREAM] Skipping AdaptationSet {i+1} with mimeType: {mime_type}")
        
        print(f"[VOD STREAM] Total stream URLs found: {len(stream_urls)}")
        
        sorted_urls = dict(sorted(stream_urls.items(), 
                                 key=lambda x: (x[1]['height'], x[1]['width']), 
                                 reverse=True))
        
        if not sorted_urls:
            print("[VOD STREAM] No stream URLs found, using default quality...")
            default_url = f"https://apis.naver.com/neonplayer/vodplay/v2/playback/{video_id}?key={in_key}&quality=720p"
            sorted_urls = {
                "1280x720": {
                    'download_url': default_url,
                    'width': 1280,
                    'height': 720,
                    'bandwidth': 2000000,
                    'quality': '720p',
                    'download_type': 'dash'
                }
            }
            print(f"[VOD STREAM] Using default stream URL: {default_url}")
        
        print(f"[VOD STREAM] Final result: {len(sorted_urls)} stream URLs")
        for resolution, info in sorted_urls.items():
            print(f"[VOD STREAM] {resolution}: {info['download_url']}")
        
        return sorted_urls
        
    except Exception as e:
        print(f"[VOD STREAM] Error getting VOD stream URLs: {e}")
        import traceback
        traceback.print_exc()
        return None

def get_vod_stream_url(video_id, in_key):
    urls = get_vod_stream_urls(video_id, in_key)
    if urls:
        first_resolution = list(urls.keys())[0]
        return urls[first_resolution]['download_url']
    return None

def _get_total_size(video_url):
    try:
        response = requests.head(video_url, timeout=30)
        response.raise_for_status()
        size = int(response.headers.get('content-length', 0))
        
        if size == 0:
            response = requests.get(video_url, stream=True, timeout=30)
            response.raise_for_status()
            size = int(response.headers.get('content-length', 0))
            response.close()
        
        return size
    except Exception as e:
        print(f"Error getting file size: {e}")
        return 0
