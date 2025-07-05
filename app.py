from flask import Flask, render_template, jsonify, request, redirect, url_for, send_from_directory
from flask_sqlalchemy import SQLAlchemy
import os
import re
import json
import requests
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
import pytz
import threading

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///streamers.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

korea_tz = pytz.timezone('Asia/Seoul')

class Streamer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_url = db.Column(db.String(200), unique=True, nullable=False)
    nickname = db.Column(db.String(100))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(korea_tz))
    last_checked = db.Column(db.DateTime)
    last_live = db.Column(db.DateTime)
    is_recording = db.Column(db.Boolean, default=False)
    current_broadcast_title = db.Column(db.String(200))
    process_id = db.Column(db.Integer)

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nid_aut = db.Column(db.String(200))
    nid_ses = db.Column(db.String(200))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(korea_tz), onupdate=lambda: datetime.now(korea_tz))

class Recording(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    streamer_id = db.Column(db.Integer, db.ForeignKey('streamer.id'), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    title = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(korea_tz))
    streamer = db.relationship('Streamer', backref=db.backref('recordings', lazy=True))





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

def download_stream(channel_id, broadcast_title, streamer_nickname, streamer_id):
    try:
        if not os.path.exists('downloads'):
            os.makedirs('downloads')
            
        streamer_dir = os.path.join('downloads', streamer_nickname)
        if not os.path.exists(streamer_dir):
            os.makedirs(streamer_dir)
            
        current_date = datetime.now(korea_tz).strftime('%y%m%d_%H%M%S')
        filename = f"{current_date} {broadcast_title} [{streamer_nickname}].ts"
        filename = re.sub(r'[<>:"/\\|?*]', '', filename)
        filepath = os.path.join(streamer_dir, filename)
        
        settings = Settings.query.first()
        if not settings or not settings.nid_aut or not settings.nid_ses:
            raise Exception("NID_AUT and NID_SES cookies are required for recording")
        
        stream_url = f"https://chzzk.naver.com/live/{channel_id}"
        command = [
            'streamlink',
            '--ffmpeg-copyts',
            '--progress', 'no',
            '--http-cookie', f'NID_AUT={settings.nid_aut}',
            '--http-cookie', f'NID_SES={settings.nid_ses}',
            stream_url,
            '720p',
            '--output', filepath
        ]
        
        process = subprocess.Popen(command)
        
        streamer = Streamer.query.get(streamer_id)
        if streamer:
            streamer.is_recording = True
            streamer.current_broadcast_title = broadcast_title
            streamer.process_id = process.pid
            
            recording = Recording(
                streamer_id=streamer_id,
                filename=os.path.join(streamer_nickname, filename),
                title=broadcast_title
            )
            db.session.add(recording)
            db.session.commit()
            
            def convert_to_mp4():
                process.wait()
                
                mp4_filename = filename.replace('.ts', '.mp4')
                mp4_filepath = os.path.join(streamer_dir, mp4_filename)
                
                try:
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
                    
                    with app.app_context():
                        recording.filename = os.path.join(streamer_nickname, mp4_filename)
                        db.session.commit()
                except Exception as e:
                    print(f"Error converting to MP4: {e}")
            
            import threading
            threading.Thread(target=convert_to_mp4, daemon=True).start()
            
        return True
    except Exception as e:
        print(f"Error downloading stream: {e}")
        return False

def check_all_streamers():
    with app.app_context():
        streamers = Streamer.query.filter_by(is_active=True).all()
        for streamer in streamers:
            channel_id = extract_channel_id(streamer.channel_url)
            if not channel_id:
                continue

            try:
                settings = Settings.query.first()
                if not settings or not settings.nid_aut or not settings.nid_ses:
                    continue

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
                    is_live = data['content'].get('status') == 'OPEN'
                    broadcast_title = data['content'].get('liveTitle')
                    
                    streamer.last_checked = datetime.now(korea_tz)
                    if is_live:
                        streamer.last_live = datetime.now(korea_tz)
                        if not streamer.is_recording:
                            download_stream(channel_id, broadcast_title, streamer.nickname, streamer.id)
                    else:
                        streamer.is_recording = False
                        streamer.current_broadcast_title = None
                    db.session.commit()

            except Exception as e:
                print(f"Error checking streamer {streamer.nickname}: {e}")

def init_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        func=check_all_streamers,
        trigger=IntervalTrigger(seconds=30),
        id='check_streamers',
        name='Check all streamers status',
        replace_existing=True
    )
    scheduler.start()

with app.app_context():
    db.create_all()
    init_scheduler()

@app.route('/')
def index():
    return redirect(url_for('live'))

@app.route('/live')
def live():
    streamers = Streamer.query.filter_by(is_active=True).all()
    settings = Settings.query.first()
    return render_template('index.html', streamers=streamers, settings=settings)

@app.route('/recordings')
def recordings():
    recordings = []
    if os.path.exists('downloads'):
        for root, dirs, files in os.walk('downloads'):
            for filename in files:
                if filename.endswith('.ts') or filename.endswith('.mp4'):
                    filepath = os.path.join(root, filename)
                    created_at = datetime.fromtimestamp(os.path.getctime(filepath), tz=korea_tz)
                    rel_path = os.path.relpath(filepath, 'downloads')
                    streamer_name = os.path.dirname(rel_path)
                    title = ' '.join(filename.split(' ')[1:-1])
                    
                    recordings.append({
                        'filename': rel_path,
                        'title': title,
                        'created_at': created_at,
                        'streamer_name': streamer_name
                    })
    
    streamer_recordings = {}
    for recording in recordings:
        if recording['streamer_name'] not in streamer_recordings:
            streamer_recordings[recording['streamer_name']] = []
        streamer_recordings[recording['streamer_name']].append(recording)
    
    for streamer_name in streamer_recordings:
        streamer_recordings[streamer_name].sort(key=lambda x: x['created_at'], reverse=True)
    
    return render_template('recordings.html', streamer_recordings=streamer_recordings)

@app.route('/recordings/<path:filename>')
def serve_recording(filename):
    return send_from_directory('downloads', filename)

@app.route('/delete_recording/<path:filename>', methods=['POST'])
def delete_recording(filename):
    try:
        filepath = os.path.join('downloads', filename)
        
        if os.path.exists(filepath):
            os.remove(filepath)
            return jsonify({
                'status': 'success',
                'message': '녹화 영상이 삭제되었습니다.'
            })
        else:
            return jsonify({
                'status': 'error',
                'message': '녹화 영상을 찾을 수 없습니다.'
            }), 404
    except Exception as e:
        print(f"Error deleting recording: {e}")
        return jsonify({
            'status': 'error',
            'message': '녹화 영상 삭제 중 오류가 발생했습니다.'
        }), 500

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'POST':
        data = request.get_json()
        nid_aut = data.get('nid_aut')
        nid_ses = data.get('nid_ses')

        settings = Settings.query.first()
        if not settings:
            settings = Settings()

        settings.nid_aut = nid_aut
        settings.nid_ses = nid_ses
        db.session.add(settings)
        db.session.commit()

        return jsonify({
            'status': 'success',
            'message': '설정이 저장되었습니다.'
        })

    settings = Settings.query.first()
    return jsonify({
        'nid_aut': settings.nid_aut if settings else '',
        'nid_ses': settings.nid_ses if settings else ''
    })

@app.route('/add_streamer', methods=['POST'])
def add_streamer():
    channel_url = request.get_json().get('channel_url')
    channel_id = extract_channel_id(channel_url)
    if not channel_id:
        return jsonify({'status': 'error', 'message': '올바른 치지직 URL이 아닙니다.'}), 400
    
    url = f'https://api.chzzk.naver.com/service/v3/channels/{channel_id}/live-detail'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': 'https://chzzk.naver.com',
        'Referer': 'https://chzzk.naver.com/'
    }
    response = requests.get(url, headers=headers)
    data = response.json()
    
    if data.get('code') != 200:
        return jsonify({'status': 'error', 'message': '치지직 이용 약관을 위반하여 정지된 채널입니다.'}), 400

    if not channel_url:
        return jsonify({'status': 'error', 'message': '채널 URL이 필요합니다.'}), 400

    channel_id = extract_channel_id(channel_url)
    if not channel_id:
        return jsonify({'status': 'error', 'message': '올바른 치지직 URL이 아닙니다.'}), 400

    nickname = get_channel_info(channel_id)
    if not nickname:
        return jsonify({'status': 'error', 'message': '채널 정보를 가져올 수 없습니다.'}), 400

    try:
        streamer = Streamer(channel_url=channel_url, nickname=nickname)
        db.session.add(streamer)
        db.session.commit()
        return jsonify({
            'status': 'success',
            'message': '스트리머가 추가되었습니다.',
            'streamer': {
                'id': streamer.id,
                'channel_url': streamer.channel_url,
                'nickname': streamer.nickname
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': '이미 등록된 채널입니다.'}), 400

@app.route('/remove_streamer/<int:streamer_id>', methods=['POST'])
def remove_streamer(streamer_id):
    try:
        streamer = Streamer.query.get_or_404(streamer_id)
        
        if streamer.is_recording and streamer.process_id:
            try:
                os.kill(streamer.process_id, 15)
                try:
                    os.waitpid(streamer.process_id, 0)
                except ChildProcessError:
                    pass
            except ProcessLookupError:
                pass
            except Exception as e:
                print(f"Warning: Error stopping recording process: {e}")
        
        Recording.query.filter_by(streamer_id=streamer_id).delete()
        
        db.session.delete(streamer)
        db.session.commit()
        
        return jsonify({'status': 'success', 'message': '스트리머가 제거되었습니다.'})
    except Exception as e:
        db.session.rollback()
        print(f"Error removing streamer: {e}")
        return jsonify({
            'status': 'error',
            'message': '스트리머 제거 중 오류가 발생했습니다.'
        }), 500

@app.route('/check_status', methods=['POST'])
def check_status():
    data = request.get_json()
    streamer_id = data.get('streamer_id')
    
    streamer = Streamer.query.get(streamer_id)
    if not streamer:
        return jsonify({'status': 'error', 'message': '스트리머를 찾을 수 없습니다.'}), 400

    channel_id = extract_channel_id(streamer.channel_url)
    if not channel_id:
        return jsonify({'status': 'error', 'message': '올바른 치지직 URL이 아닙니다.'}), 400

    try:
        settings = Settings.query.first()
        if not settings or not settings.nid_aut or not settings.nid_ses:
            return jsonify({
                'status': 'error',
                'error_code': 'missing_cookies',
                'message': 'NID_AUT 또는 NID_SES 쿠키가 설정되지 않았습니다. 설정에서 쿠키 값을 입력해주세요.'
            }), 400

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

        is_live = False
        broadcast_title = None
        download_started = False
        broadcast_info = {}
        
        if data.get('code') == 200 and data.get('content'):
            is_live = data['content'].get('status') == 'OPEN'
            broadcast_title = data['content'].get('liveTitle')
            
            # 방송 정보 수집
            if data['content'].get('liveTitle'):
                broadcast_info['title'] = data['content']['liveTitle']
                broadcast_info['category'] = data['content'].get('liveCategoryValue', '')
                broadcast_info['tags'] = data['content'].get('tags', [])
                
                # openDate가 있으면 파싱
                if data['content'].get('openDate'):
                    try:
                        open_date = datetime.fromisoformat(data['content']['openDate'].replace('Z', '+00:00'))
                        broadcast_info['open_date'] = open_date.astimezone(korea_tz).strftime('%Y-%m-%d %H:%M')
                    except:
                        pass
            
            streamer.last_checked = datetime.now(korea_tz)
            if is_live:
                streamer.last_live = datetime.now(korea_tz)
                if not streamer.is_recording:
                    download_started = download_stream(channel_id, broadcast_title, streamer.nickname, streamer.id)
            else:
                streamer.is_recording = False
                streamer.current_broadcast_title = None
            db.session.commit()

        return jsonify({
            'status': 'success',
            'is_live': is_live,
            'broadcast_title': broadcast_title,
            'is_recording': streamer.is_recording,
            'download_started': download_started,
            'broadcast_info': broadcast_info,
            'message': '방송 상태를 확인했습니다.'
        })
    except Exception as e:
        print(f"Error checking status: {e}")
        return jsonify({'status': 'error', 'message': '방송 상태 확인 중 오류가 발생했습니다.'}), 500

@app.route('/stop_recording/<int:streamer_id>', methods=['POST'])
def stop_recording(streamer_id):
    try:
        streamer = Streamer.query.get_or_404(streamer_id)
        if streamer.is_recording and streamer.process_id:
            try:
                os.kill(streamer.process_id, 15)
                try:
                    os.waitpid(streamer.process_id, 0)
                except ChildProcessError:
                    pass
            except ProcessLookupError:
                pass
            except Exception as e:
                print(f"Warning: Error stopping recording process: {e}")
            
            streamer.is_recording = False
            streamer.current_broadcast_title = None
            streamer.process_id = None
            db.session.commit()
            
            return jsonify({
                'status': 'success',
                'message': '녹화가 중지되었습니다.'
            })
        else:
            return jsonify({
                'status': 'error',
                'message': '녹화 중이 아닙니다.'
            }), 400
    except Exception as e:
        db.session.rollback()
        print(f"Error stopping recording: {e}")
        return jsonify({
            'status': 'error',
            'message': '녹화 중지 중 오류가 발생했습니다.'
        }), 500

def clean_filename(filename):
    """파일명에서 특수문자 제거"""
    cleaned_filename = re.sub(r'[♥♡ღ⭐㉦✧》《♠♦❤️♣✿ꈍᴗ\/@!~*\[\]\#\$\%\^\&\(\)\-\_\=\+\<\>\?\;\:\'\"]', '', filename)
    return cleaned_filename

def get_vod_info(video_no):
    """VOD 정보 가져오기"""
    api_url = f"https://api.chzzk.naver.com/service/v2/videos/{video_no}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
    }
    
    try:
        response = requests.get(api_url, headers=headers)
        response.raise_for_status()
        
        if response.status_code == 404:
            return None
            
        content = response.json().get('content', {})
        video_id = content.get('videoId')
        in_key = content.get('inKey')
        
        if video_id is None or in_key is None:
            # 로그인이 필요한 경우 쿠키 사용
            settings = Settings.query.first()
            if settings and settings.nid_aut and settings.nid_ses:
                cookies = {
                    'NID_AUT': settings.nid_aut,
                    'NID_SES': settings.nid_ses
                }
                response = requests.get(api_url, cookies=cookies, headers=headers)
                response.raise_for_status()
                content = response.json().get('content', {})
                video_id = content.get('videoId')
                in_key = content.get('inKey')
        
        if video_id and in_key:
            return {
                'video_id': video_id,
                'in_key': in_key,
                'title': content.get('videoTitle'),
                'author': content.get('channel', {}).get('channelName'),
                'category': content.get('videoCategory'),
                'tags': content.get('tags', [])
            }
        
        return None
    except Exception as e:
        print(f"Error fetching VOD info: {e}")
        return None

def get_vod_stream_urls(video_id, in_key):
    """VOD 스트림 URL과 해상도 정보 가져오기"""
    vod_url = f"https://apis.naver.com/neonplayer/vodplay/v2/playback/{video_id}?key={in_key}"
    
    try:
        # 더 자세한 헤더 추가
        headers = {
            "Accept": "application/dash+xml",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Origin": "https://chzzk.naver.com",
            "Referer": "https://chzzk.naver.com/"
        }
        
        response = requests.get(vod_url, headers=headers)
        response.raise_for_status()
        
        # 응답 내용 확인
        if len(response.text) < 100:
            return None
        
        # JSON 응답인지 확인
        if response.text.strip().startswith('{'):
            print("Received JSON response, trying to parse...")
            try:
                json_data = response.json()
                print(f"JSON response: {json_data}")
                
                # JSON에서 BaseURL 찾기
                if 'baseURL' in json_data:
                    base_url = json_data['baseURL']
                    if "pstatic.net" in base_url:
                        # 기본 해상도로 URL 생성
                        stream_urls = {
                            "1280x720": {
                                'download_url': base_url,
                                'width': 1280,
                                'height': 720,
                                'bandwidth': 2000000,
                                'quality': '720p'
                            }
                        }
                        return stream_urls
                
                # JSON에서 representation 정보 찾기
                if 'period' in json_data and 'adaptationSet' in json_data['period'][0]:
                    stream_urls = {}
                    adaptation_sets = json_data['period'][0]['adaptationSet']
                    for adaptation_set in adaptation_sets:
                        if adaptation_set.get('mimeType', '').startswith('video'):
                            representations = adaptation_set.get('representation', [])
                            for rep in representations:
                                width = rep.get('width')
                                height = rep.get('height')
                                bandwidth = rep.get('bandwidth')
                                
                                if width and height:
                                    resolution = f"{width}x{height}"
                                    base_url = rep.get('baseURL', [{}])[0].get('value', '')
                                    
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
                                        
                                        stream_urls[resolution] = {
                                            'download_url': base_url,
                                            'width': int(width),
                                            'height': int(height),
                                            'bandwidth': int(bandwidth) if bandwidth else 0,
                                            'quality': quality
                                        }
                                        print(f"Added download URL for {resolution} ({quality}): {base_url}")
                    
                    if stream_urls:
                        return dict(sorted(stream_urls.items(), 
                                         key=lambda x: (x[1]['height'], x[1]['width']), 
                                         reverse=True))
            except Exception as e:
                print(f"JSON parsing error: {e}")
                pass
        
        # XML 파싱 시도
        try:
            root = ET.fromstring(response.text)
        except ET.ParseError as e:
            print(f"XML parsing error: {e}")
            return None
        ns = {"mpd": "urn:mpeg:dash:schema:mpd:2011", "nvod": "urn:naver:vod:2020"}
        
        # XML 구조 디버깅
        print("XML Structure Debug:")
        print(f"Root tag: {root.tag}")
        
        # 모든 BaseURL 찾기
        all_base_urls = root.findall(".//mpd:BaseURL", namespaces=ns)
        print(f"Found {len(all_base_urls)} BaseURL elements:")
        for i, url in enumerate(all_base_urls):
            print(f"  {i+1}: {url.text}")
        
        # 다양한 해상도의 스트림 URL 찾기
        stream_urls = {}
        
        # AdaptationSet에서 Representation 찾기
        adaptation_sets = root.findall(".//mpd:AdaptationSet", namespaces=ns)
        
        for i, adaptation_set in enumerate(adaptation_sets):
            mime_type = adaptation_set.get('mimeType', '')
            
            # video/mp4 타입의 AdaptationSet만 처리 (첫 번째 AdaptationSet)
            if mime_type == 'video/mp4':
                print(f"Processing video/mp4 AdaptationSet {i+1}")
                representations = adaptation_set.findall(".//mpd:Representation", namespaces=ns)
                
                for j, rep in enumerate(representations):
                    width = rep.get('width')
                    height = rep.get('height')
                    bandwidth = rep.get('bandwidth')
                    
                    if width and height:
                        resolution = f"{width}x{height}"
                        
                        # Representation 내부의 BaseURL 찾기
                        base_url_element = rep.find(".//mpd:BaseURL", namespaces=ns)
                        if base_url_element is not None:
                            base_url = base_url_element.text
                            print(f"Found BaseURL for {resolution}: {base_url}")
                            
                            # pstatic.net URL인지 확인
                            if "pstatic.net" in base_url:
                                # 화질 매핑
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
                                
                                stream_urls[resolution] = {
                                    'download_url': base_url,
                                    'width': int(width),
                                    'height': int(height),
                                    'bandwidth': int(bandwidth) if bandwidth else 0,
                                    'quality': quality
                                }
                                print(f"Added download URL for {resolution} ({quality}): {base_url}")
                            else:
                                print(f"BaseURL is not pstatic.net for {resolution}: {base_url}")
                        else:
                            print(f"No BaseURL found for {resolution}")
                    else:
                        print(f"Missing width or height for representation {j}")
            else:
                print(f"Skipping AdaptationSet {i+1} with mimeType: {mime_type}")
        
        print(f"Total stream URLs found: {len(stream_urls)}")
        
        # 해상도별로 정렬 (높은 해상도부터)
        sorted_urls = dict(sorted(stream_urls.items(), 
                                 key=lambda x: (x[1]['height'], x[1]['width']), 
                                 reverse=True))
        
        # 만약 스트림 URL을 찾지 못했다면, 기본 해상도로 시도
        if not sorted_urls:
            print("No stream URLs found, using default quality...")
            sorted_urls = {
                "1280x720": {
                    'download_url': f"https://apis.naver.com/neonplayer/vodplay/v2/playback/{video_id}?key={in_key}&quality=720p",
                    'width': 1280,
                    'height': 720,
                    'bandwidth': 2000000,
                    'quality': '720p'
                }
            }
            print(f"Using default stream URL: {sorted_urls['1280x720']['download_url']}")
        
        return sorted_urls
        
    except Exception as e:
        print(f"Error getting VOD stream URLs: {e}")
        import traceback
        traceback.print_exc()
        return None

def get_vod_stream_url(video_id, in_key):
    """VOD 스트림 URL 가져오기 (기본 해상도)"""
    urls = get_vod_stream_urls(video_id, in_key)
    if urls:
        # 가장 높은 해상도 반환
        first_resolution = list(urls.keys())[0]
        return urls[first_resolution]['media_url_template']
    return None



def _get_total_size(video_url):
    """HEAD 요청으로 파일 크기를 구한다"""
    try:
        response = requests.head(video_url, timeout=30)
        response.raise_for_status()
        size = int(response.headers.get('content-length', 0))
        
        if size == 0:
            # HEAD 요청으로 크기를 알 수 없는 경우 GET 요청으로 확인
            response = requests.get(video_url, stream=True, timeout=30)
            response.raise_for_status()
            size = int(response.headers.get('content-length', 0))
            response.close()
        
        return size
    except Exception as e:
        print(f"Error getting file size: {e}")
        return 0

@app.route('/vod')
def vod():
    return render_template('vod.html')

@app.route('/get_vod_info', methods=['POST'])
def get_vod_info_route():
    data = request.get_json()
    vod_url = data.get('vod_url')
    
    # URL에서 video_no 추출
    match = re.match(r'https?://chzzk\.naver\.com/video/(\d+)', vod_url)
    if not match:
        return jsonify({'status': 'error', 'message': '올바른 치지직 VOD URL이 아닙니다.'}), 400
    
    video_no = match.group(1)
    
    try:
        # VOD 정보 가져오기
        vod_info = get_vod_info(video_no)
        if not vod_info:
            return jsonify({'status': 'error', 'message': 'VOD 정보를 가져올 수 없습니다. 로그인이 필요할 수 있습니다.'}), 400
        
        # 모든 해상도의 스트림 URL 가져오기
        stream_urls = get_vod_stream_urls(vod_info['video_id'], vod_info['in_key'])
        if not stream_urls:
            return jsonify({'status': 'error', 'message': '스트림 URL을 가져올 수 없습니다.'}), 400
        
        # 기본 해상도 (가장 높은 해상도)
        default_resolution = list(stream_urls.keys())[0]
        default_download_url = stream_urls[default_resolution]['download_url']
        
        # 해상도 정보 정리
        resolutions = []
        for resolution, info in stream_urls.items():
            # 대략적인 파일 크기 계산 (bandwidth * duration / 8)
            estimated_size_mb = round((info['bandwidth'] * 3600 / 8) / 1024 / 1024, 1) if info['bandwidth'] > 0 else 0
            
            resolutions.append({
                'resolution': resolution,
                'width': info['width'],
                'height': info['height'],
                'bandwidth': info['bandwidth'],
                'quality': info['quality'],
                'download_url': info['download_url'],
                'estimated_size_mb': estimated_size_mb
            })
        
        return jsonify({
            'status': 'success',
            'video_info': vod_info,
            'resolutions': resolutions,
            'default_resolution': default_resolution,
            'message': 'VOD 정보를 성공적으로 가져왔습니다.'
        })
        
    except Exception as e:
        print(f"Error getting VOD info: {e}")
        return jsonify({'status': 'error', 'message': f'VOD 정보 가져오기 중 오류가 발생했습니다: {str(e)}'}), 500



if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=3000) 