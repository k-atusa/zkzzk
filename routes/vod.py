from flask import Blueprint, render_template, request, jsonify, g
import os
import subprocess
import re
from datetime import datetime
from core.utils import get_vod_info, get_vod_stream_urls

vod_bp = Blueprint('vod', __name__)

@vod_bp.route('/vod')
def vod():
    return render_template('vod.html', current_page='vod')

@vod_bp.route('/get_vod_info', methods=['POST'])
def get_vod_info_route():
    data = request.get_json()
    vod_url = data.get('vod_url')
    print(f"[VOD ROUTE] Received VOD URL: {vod_url}")
    
    match = re.match(r'https?://chzzk\.naver\.com/video/(\d+)', vod_url)
    if not match:
        print(f"[VOD ROUTE] Invalid VOD URL format: {vod_url}")
        return jsonify({'status': 'error', 'message': '올바른 치지직 VOD URL이 아닙니다.'}), 400
    
    video_no = match.group(1)
    print(f"[VOD ROUTE] Extracted video_no: {video_no}")
    
    try:
        print(f"[VOD ROUTE] Getting VOD info for video_no: {video_no}")
        vod_info = get_vod_info(video_no)
        if not vod_info:
            print(f"[VOD ROUTE] Failed to get VOD info for video_no: {video_no}")
            return jsonify({'status': 'error', 'message': 'VOD 정보를 가져올 수 없습니다. 로그인이 필요할 수 있습니다.'}), 400
        
        print(f"[VOD ROUTE] Successfully got VOD info: {vod_info['title']}")
        
        print(f"[VOD ROUTE] Getting stream URLs for video_id: {vod_info['video_id']}")
        stream_urls = get_vod_stream_urls(
            vod_info['video_id'],
            vod_info['in_key'],
            vod_info.get('live_rewind_playback_json')
        )
        if not stream_urls:
            print(f"[VOD ROUTE] Failed to get stream URLs for video_id: {vod_info['video_id']}")
            return jsonify({'status': 'error', 'message': '스트림 URL을 가져올 수 없습니다.'}), 400
        
        print(f"[VOD ROUTE] Successfully got {len(stream_urls)} stream URLs")
        
        default_resolution = list(stream_urls.keys())[0]
        default_download_url = stream_urls[default_resolution]['download_url']
        print(f"[VOD ROUTE] Default resolution: {default_resolution}, URL: {default_download_url}")
        
        resolutions = []
        for resolution, info in stream_urls.items():
            estimated_size_mb = round((info['bandwidth'] * 3600 / 8) / 1024 / 1024, 1) if info['bandwidth'] > 0 else 0
            
            resolution_info = {
                'resolution': resolution,
                'width': info['width'],
                'height': info['height'],
                'bandwidth': info['bandwidth'],
                'quality': info['quality'],
                'download_url': info['download_url'],
                'download_type': info.get('download_type', 'direct'),
                'estimated_size_mb': estimated_size_mb
            }
            resolutions.append(resolution_info)
            print(f"[VOD ROUTE] Resolution {resolution}: {info['download_url']}")
        
        print(f"[VOD ROUTE] Returning {len(resolutions)} resolutions to client")
        response_video_info = {k: v for k, v in vod_info.items() if k != 'live_rewind_playback_json'}
        return jsonify({
            'status': 'success',
            'video_info': response_video_info,
            'resolutions': resolutions,
            'default_resolution': default_resolution,
            'message': 'VOD 정보를 성공적으로 가져왔습니다.'
        })
        
    except Exception as e:
        print(f"[VOD ROUTE] Error getting VOD info: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': f'VOD 정보 가져오기 중 오류가 발생했습니다: {str(e)}'}), 500

@vod_bp.route('/download_vod', methods=['POST'])
def download_vod():
    try:
        data = request.get_json()
        download_url = data.get('download_url')
        video_info = data.get('video_info') or {}
        resolution = data.get('resolution')
        download_type = (resolution or {}).get('download_type', 'direct')
        
        if not download_url:
            return jsonify({'status': 'error', 'message': '다운로드 URL이 필요합니다.'}), 400

        if not g.user or not g.user.username:
            return jsonify({'status': 'error', 'message': '로그인이 필요합니다.'}), 401
        
        streamer_nickname = video_info.get('author') or 'Unknown'
        streamer_nickname = re.sub(r'[<>:"/\\|?*]', '', streamer_nickname).strip()
        
        raw_publish_date = video_info.get('raw_publish_date')
        if raw_publish_date:
            try:
                pub_datetime = datetime.fromisoformat(raw_publish_date.replace('Z', '+00:00'))
                local_pub_datetime = pub_datetime.astimezone(datetime.now().tzinfo)
                date_prefix = local_pub_datetime.strftime('%y%m%d_%H%M%S')
            except Exception as e:
                print(f"[VOD DOWNLOAD] Error parsing raw_publish_date: {e}")
                date_prefix = datetime.now().strftime('%y%m%d_%H%M%S')
        else:
            date_prefix = datetime.now().strftime('%y%m%d_%H%M%S')

        clean_title = re.sub(r'[<>:"/\\|?*]', '', video_info.get('title', 'Unknown')).strip()
        filename = f"{date_prefix} {clean_title} [{streamer_nickname}].mp4"

        print(f"[VOD DOWNLOAD] Starting server download: {filename}")
        print(f"[VOD DOWNLOAD] URL: {download_url}")
        
        if not os.path.exists('downloads'):
            os.makedirs('downloads')
        
        vod_dir = os.path.join('downloads', g.user.username, 'vod', streamer_nickname)
        if not os.path.exists(vod_dir):
            os.makedirs(vod_dir)
        
        filepath = os.path.join(vod_dir, filename)
        
        if os.path.exists(filepath):
            return jsonify({'status': 'error', 'message': '이미 동일한 파일이 존재합니다.'}), 400
        
        def download_file():
            try:
                print(f"[VOD DOWNLOAD] Downloading to: {filepath}")

                is_stream = download_type in ('m3u8', 'dash') or '.m3u8' in (download_url or '') or '?key=' in (download_url or '')
                if is_stream:
                    print(f"[VOD DOWNLOAD] Starting ffmpeg stream download: {filename}")
                    ffmpeg_headers = (
                        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36\r\n"
                        "Origin: https://chzzk.naver.com\r\n"
                        "Referer: https://chzzk.naver.com/\r\n"
                        "Accept: application/dash+xml, */*\r\n"
                    )
                    ffmpeg_command = [
                        'ffmpeg',
                        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
                        '-allowed_extensions', 'ALL',
                        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                        '-referer', 'https://chzzk.naver.com/',
                        '-headers', ffmpeg_headers,
                        '-i', download_url,
                        '-c', 'copy',
                        '-movflags', '+faststart',
                        '-start_at_zero',
                        '-y',
                        filepath
                    ]
                    result = subprocess.run(ffmpeg_command, capture_output=True, text=True)
                    if result.returncode != 0:
                        print(f"[VOD DOWNLOAD] ffmpeg failed with return code: {result.returncode}")
                        print(f"[VOD DOWNLOAD] ffmpeg stderr: {result.stderr}")
                        print("[VOD DOWNLOAD] Trying streamlink fallback for m3u8...")

                        temp_ts_filepath = filepath + '.ts'
                        streamlink_command = [
                            'streamlink',
                            '--http-header', 'User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                            '--http-header', 'Origin=https://chzzk.naver.com',
                            '--http-header', 'Referer=https://chzzk.naver.com/',
                            '--stream-segment-threads', '4',
                            download_url,
                            'best',
                            '--output', temp_ts_filepath
                        ]
                        streamlink_result = subprocess.run(streamlink_command, capture_output=True, text=True)
                        if streamlink_result.returncode != 0:
                            print(f"[VOD DOWNLOAD] streamlink fallback failed: {streamlink_result.stderr}")
                            raise Exception(f"ffmpeg m3u8 download failed: {result.stderr}")

                        print(f"[VOD DOWNLOAD] streamlink fallback completed: {temp_ts_filepath}")
                        try:
                            remux_command = [
                                'ffmpeg',
                                '-fflags', '+genpts',
                                '-analyzeduration', '100M',
                                '-probesize', '100M',
                                '-i', temp_ts_filepath,
                                '-map', '0:v:0',
                                '-map', '0:a:0?',
                                '-c', 'copy',
                                '-bsf:a', 'aac_adtstoasc',
                                '-movflags', '+faststart',
                                '-y',
                                filepath
                            ]
                            remux_result = subprocess.run(remux_command, capture_output=True, text=True)

                            if remux_result.returncode != 0:
                                print(f"[VOD DOWNLOAD] lossless remux failed: {remux_result.stderr}")
                                transcode_command = [
                                    'ffmpeg',
                                    '-fflags', '+genpts',
                                    '-analyzeduration', '100M',
                                    '-probesize', '100M',
                                    '-i', temp_ts_filepath,
                                    '-map', '0:v:0',
                                    '-map', '0:a:0?',
                                    '-c:v', 'libx264',
                                    '-preset', 'veryfast',
                                    '-crf', '23',
                                    '-c:a', 'aac',
                                    '-b:a', '192k',
                                    '-movflags', '+faststart',
                                    '-y',
                                    filepath
                                ]
                                transcode_result = subprocess.run(transcode_command, capture_output=True, text=True)
                                if transcode_result.returncode != 0:
                                    print(f"[VOD DOWNLOAD] re-encode remux failed: {transcode_result.stderr}")
                                    raise Exception(f"streamlink fallback remux failed: {transcode_result.stderr}")

                            if os.path.exists(filepath) and os.path.exists(temp_ts_filepath):
                                os.remove(temp_ts_filepath)
                        except Exception as remux_error:
                            print(f"[VOD DOWNLOAD] streamlink remux failed: {remux_error}")
                            raise Exception(f"streamlink fallback remux failed: {remux_error}")
                    print(f"[VOD DOWNLOAD] ffmpeg m3u8 download completed: {filepath}")
                else:
                    wget_command = [
                        'wget',
                        '--timeout=30',
                        '--tries=3',
                        '--continue',
                        '--quiet',
                        '--output-document=' + filepath,
                        download_url
                    ]

                    print(f"[VOD DOWNLOAD] Starting direct download: {filename}")
                    result = subprocess.run(wget_command, capture_output=True, text=True)

                    if result.returncode == 0:
                        print(f"[VOD DOWNLOAD] Download completed: {filepath}")

                        if filepath.endswith('.ts'):
                            mp4_filepath = filepath.replace('.ts', '.mp4')
                            try:
                                print(f"[VOD DOWNLOAD] Converting to MP4: {mp4_filepath}")
                                ffmpeg_command = [
                                    'ffmpeg',
                                    '-i', filepath,
                                    '-c', 'copy',
                                    '-start_at_zero',
                                    '-y',
                                    mp4_filepath
                                ]
                                subprocess.run(ffmpeg_command, check=True)
                                os.remove(filepath)
                                print(f"[VOD DOWNLOAD] Conversion completed: {mp4_filepath}")
                            except Exception as e:
                                print(f"[VOD DOWNLOAD] Error converting to MP4: {e}")
                    else:
                        print(f"[VOD DOWNLOAD] wget failed with return code: {result.returncode}")
                        print(f"[VOD DOWNLOAD] wget stderr: {result.stderr}")
                        raise Exception(f"wget download failed: {result.stderr}")
                
            except Exception as e:
                print(f"[VOD DOWNLOAD] Error during download: {e}")
                if os.path.exists(filepath):
                    os.remove(filepath)
        
        import threading
        download_thread = threading.Thread(target=download_file, daemon=True)
        download_thread.start()
        
        return jsonify({
            'status': 'success',
            'message': '서버 다운로드가 시작되었습니다.',
            'filename': filename
        })
        
    except Exception as e:
        print(f"[VOD DOWNLOAD] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': f'다운로드 중 오류가 발생했습니다: {str(e)}'}), 500
