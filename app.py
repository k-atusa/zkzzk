from flask import Flask, render_template, jsonify, request, redirect, url_for, send_from_directory, session, g
from werkzeug.security import generate_password_hash, check_password_hash
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
import threading
import secrets

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now())

class Streamer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_url = db.Column(db.String(200), unique=True, nullable=False)
    nickname = db.Column(db.String(100))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now())
    last_checked = db.Column(db.DateTime)
    last_live = db.Column(db.DateTime)
    is_recording = db.Column(db.Boolean, default=False)
    current_broadcast_title = db.Column(db.String(200))
    process_id = db.Column(db.Integer)
    user = db.relationship('User', backref=db.backref('streamers', lazy=True))

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nid_aut = db.Column(db.String(200))
    nid_ses = db.Column(db.String(200))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(), onupdate=lambda: datetime.now())
    initialized = db.Column(db.Boolean, default=False)

class Recording(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    streamer_id = db.Column(db.Integer, db.ForeignKey('streamer.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    filename = db.Column(db.String(200), nullable=False)
    title = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=lambda: datetime.now())
    streamer = db.relationship('Streamer', backref=db.backref('recordings', lazy=True))
    user = db.relationship('User', backref=db.backref('recordings', lazy=True))





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
            
        current_date = datetime.now().strftime('%y%m%d_%H%M%S')
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
                    
                    streamer.last_checked = datetime.now()
                    if is_live:
                        streamer.last_live = datetime.now()
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

    try:
        result = db.session.execute("PRAGMA table_info(settings)")
        columns = [row[1] for row in result]
        if 'initialized' not in columns:
            db.session.execute('ALTER TABLE settings ADD COLUMN initialized BOOLEAN DEFAULT 0')
            db.session.commit()
    except Exception as e:
        print(f"Warning: could not ensure settings table columns: {e}")

    try:
        result = db.session.execute("PRAGMA table_info(streamer)")
        columns = [row[1] for row in result]
        if 'user_id' not in columns:
            db.session.execute('ALTER TABLE streamer ADD COLUMN user_id INTEGER')
            db.session.commit()
    except Exception as e:
        print(f"Warning: could not ensure user_id on streamer: {e}")

    try:
        result = db.session.execute("PRAGMA table_info(recording)")
        columns = [row[1] for row in result]
        if 'user_id' not in columns:
            db.session.execute('ALTER TABLE recording ADD COLUMN user_id INTEGER')
            db.session.commit()
    except Exception as e:
        print(f"Warning: could not ensure user_id on recording: {e}")
    init_scheduler()

@app.before_request
def require_login():
    g.user = None
    if request.path.startswith('/static'):
        return
    # Ensure setup first on first deploy
    settings_row = Settings.query.first()
    user_count = User.query.count()
    first_run = (not settings_row or not settings_row.initialized) or (user_count == 0)
    if first_run and request.endpoint not in ('setup_admin', 'static'):
        return redirect(url_for('setup_admin'))

    # Allow auth-free endpoints
    if request.endpoint in ('login', 'logout', 'static', 'setup_admin'):
        return

    user_id = session.get('user_id')
    if user_id:
        g.user = User.query.get(user_id)
    if not g.user:
        return redirect(url_for('login'))

@app.route('/setup', methods=['GET', 'POST'])
def setup_admin():
    # If already initialized, go to app
    settings_row = Settings.query.first()
    if settings_row and settings_row.initialized and User.query.count() > 0:
        return redirect(url_for('live'))
    if request.method == 'POST':
        form = request.get_json(silent=True) or request.form
        username = form.get('username', '').strip()
        password = form.get('password', '').strip()
        if not username or not password:
            return render_template('login.html', error='관리자 사용자 생성: 사용자명과 비밀번호가 필요합니다.', setup_mode=True)
        if User.query.filter_by(username=username).first():
            return render_template('login.html', error='이미 존재하는 사용자명입니다.', setup_mode=True)
        user = User(username=username, password_hash=generate_password_hash(password), is_admin=True)
        db.session.add(user)
        # mark settings initialized
        settings_row = Settings.query.first() or Settings()
        settings_row.initialized = True
        db.session.add(settings_row)
        db.session.commit()
        session['user_id'] = user.id
        return redirect(url_for('live'))
    return render_template('login.html', setup_mode=True)

@app.route('/login', methods=['GET', 'POST'])
def login():
    # Force admin creation before any login on first deploy
    settings_row = Settings.query.first()
    if (not settings_row or not settings_row.initialized) or User.query.count() == 0:
        return redirect(url_for('setup_admin'))
    if request.method == 'POST':
        form = request.get_json(silent=True) or request.form
        username = form.get('username')
        password = form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            session['user_id'] = user.id
            return redirect(url_for('live'))
        return render_template('login.html', error='아이디 또는 비밀번호가 올바르지 않습니다.', setup_mode=False)
    return render_template('login.html', setup_mode=False)

@app.route('/logout', methods=['POST', 'GET'])
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
def index():
    return redirect(url_for('live'))

@app.route('/live')
def live():
    user = g.user
    streamers = Streamer.query.filter_by(is_active=True, user_id=user.id).all()
    settings = Settings.query.first()
    return render_template('index.html', streamers=streamers, settings=settings, current_page='live')

@app.route('/recordings')
def recordings():
    user = g.user
    recordings = []
    if os.path.exists('downloads'):
        for root, dirs, files in os.walk('downloads'):
            for filename in files:
                if filename.endswith('.ts') or filename.endswith('.mp4'):
                    filepath = os.path.join(root, filename)
                    created_at = datetime.fromtimestamp(os.path.getctime(filepath), tz=datetime.now().tzinfo)
                    rel_path = os.path.relpath(filepath, 'downloads')
                    streamer_name = os.path.dirname(rel_path)
                    title = ' '.join(filename.split(' ')[1:-1])
                    
                    user_streamer_nicks = {s.nickname for s in Streamer.query.filter_by(user_id=user.id).all()}
                    if streamer_name in user_streamer_nicks:
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
    
    return render_template('recordings.html', streamer_recordings=streamer_recordings, current_page='recordings')

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
    user = g.user
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
        streamer = Streamer(channel_url=channel_url, nickname=nickname, user_id=user.id)
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
        user = g.user
        streamer = Streamer.query.get_or_404(streamer_id)
        if streamer.user_id != user.id and not (g.user and g.user.is_admin):
            return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403
        
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
    if g.user and (streamer.user_id != g.user.id) and not g.user.is_admin:
        return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403

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
            

            if data['content'].get('liveTitle'):
                broadcast_info['title'] = data['content']['liveTitle']
                broadcast_info['category'] = data['content'].get('liveCategoryValue', '')
                broadcast_info['tags'] = data['content'].get('tags', [])
                
                if data['content'].get('openDate'):
                    try:
                        open_date = datetime.fromisoformat(data['content']['openDate'].replace('Z', '+00:00'))
                        broadcast_info['open_date'] = open_date.astimezone(datetime.now().tzinfo).strftime('%Y-%m-%d %H:%M')
                    except:
                        pass
            
            streamer.last_checked = datetime.now()
            if is_live:
                streamer.last_live = datetime.now()
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
        if g.user and (streamer.user_id != g.user.id) and not g.user.is_admin:
            return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403
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
    cleaned_filename = re.sub(r'[♥♡ღ⭐㉦✧》《♠♦❤️♣✿ꈍᴗ\/@!~*\[\]\#\$\%\^\&\(\)\-\_\=\+\<\>\?\;\:\'\"]', '', filename)
    return cleaned_filename

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
        
        print(f"[VOD INFO] Video ID: {video_id}, In Key: {in_key}")
        
        if video_id is None or in_key is None:
            settings = Settings.query.first()
            if settings and settings.nid_aut and settings.nid_ses:
                print(f"[VOD INFO] Using cookies for authentication")
                cookies = {
                    'NID_AUT': settings.nid_aut,
                    'NID_SES': settings.nid_ses
                }
                response = requests.get(api_url, cookies=cookies, headers=headers)
                response.raise_for_status()
                content = response.json().get('content', {})
                video_id = content.get('videoId')
                in_key = content.get('inKey')
                print(f"[VOD INFO] After auth - Video ID: {video_id}, In Key: {in_key}")
        
        if video_id and in_key:
            publish_date = content.get('publishDate')
            formatted_publish_date = None
            if publish_date:
                try:
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
                'publish_date': formatted_publish_date
            }
            print(f"[VOD INFO] Successfully retrieved VOD info: {vod_info['title']}")
            return vod_info
        
        print(f"[VOD INFO] Failed to get video_id or in_key")
        return None
    except Exception as e:
        print(f"Error fetching VOD info: {e}")
        return None

def get_vod_stream_urls(video_id, in_key):
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
                                
                                stream_urls[resolution] = {
                                    'download_url': base_url,
                                    'width': int(width),
                                    'height': int(height),
                                    'bandwidth': int(bandwidth) if bandwidth else 0,
                                    'quality': quality
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
                    'quality': '720p'
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
        return urls[first_resolution]['media_url_template']
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

@app.route('/vod')
def vod():
    return render_template('vod.html', current_page='vod')

@app.route('/get_vod_info', methods=['POST'])
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
        stream_urls = get_vod_stream_urls(vod_info['video_id'], vod_info['in_key'])
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
                'estimated_size_mb': estimated_size_mb
            }
            resolutions.append(resolution_info)
            print(f"[VOD ROUTE] Resolution {resolution}: {info['download_url']}")
        
        print(f"[VOD ROUTE] Returning {len(resolutions)} resolutions to client")
        return jsonify({
            'status': 'success',
            'video_info': vod_info,
            'resolutions': resolutions,
            'default_resolution': default_resolution,
            'message': 'VOD 정보를 성공적으로 가져왔습니다.'
        })
        
    except Exception as e:
        print(f"[VOD ROUTE] Error getting VOD info: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': f'VOD 정보 가져오기 중 오류가 발생했습니다: {str(e)}'}), 500

@app.context_processor
def inject_user():
    return {'current_user': g.user}

@app.route('/admin/users', methods=['GET', 'POST', 'DELETE'])
def admin_users():
    if not g.user or not g.user.is_admin:
        return redirect(url_for('live'))
    if request.method == 'GET':
        users = User.query.all()
        return render_template('admin.html', users=users)
    if request.method == 'POST':
        data = request.get_json() or request.form
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        is_admin = bool(data.get('is_admin'))
        if not username or not password:
            return jsonify({'status': 'error', 'message': 'username/password 필요'}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({'status': 'error', 'message': '이미 존재하는 사용자명'}), 400
        user = User(username=username, password_hash=generate_password_hash(password), is_admin=is_admin)
        db.session.add(user)
        db.session.commit()
        return jsonify({'status': 'success'})
    if request.method == 'DELETE':
        data = request.get_json() or {}
        user_id = int(data.get('user_id') or 0)
        if user_id == g.user.id:
            return jsonify({'status': 'error', 'message': '본인 삭제 불가'}), 400
        user = User.query.get_or_404(user_id)
        db.session.delete(user)
        db.session.commit()
        return jsonify({'status': 'success'})

@app.route('/profile', methods=['GET', 'POST'])
def profile():
    if not g.user:
        return redirect(url_for('login'))
    if request.method == 'POST':
        data = request.get_json() or request.form
        new_password = data.get('new_password', '').strip()
        if new_password:
            g.user.password_hash = generate_password_hash(new_password)
            db.session.commit()
            return jsonify({'status': 'success', 'message': '비밀번호가 변경되었습니다.'})
        return jsonify({'status': 'error', 'message': '새 비밀번호를 입력하세요.'}), 400
    return render_template('profile.html')



@app.route('/download_vod', methods=['POST'])
def download_vod():
    try:
        data = request.get_json()
        download_url = data.get('download_url')
        filename = data.get('filename')
        video_info = data.get('video_info')
        resolution = data.get('resolution')
        
        print(f"[VOD DOWNLOAD] Starting server download: {filename}")
        print(f"[VOD DOWNLOAD] URL: {download_url}")
        
        if not download_url or not filename:
            return jsonify({'status': 'error', 'message': '다운로드 URL과 파일명이 필요합니다.'}), 400
        
        if not os.path.exists('downloads'):
            os.makedirs('downloads')
        
        vod_dir = os.path.join('downloads', 'vod')
        if not os.path.exists(vod_dir):
            os.makedirs(vod_dir)
        
        filepath = os.path.join(vod_dir, filename)
        
        if os.path.exists(filepath):
            return jsonify({'status': 'error', 'message': '이미 동일한 파일이 존재합니다.'}), 400
        
        def download_file():
            try:
                print(f"[VOD DOWNLOAD] Downloading to: {filepath}")
                
                wget_command = [
                    'wget',
                    '--timeout=30',
                    '--tries=3',
                    '--continue',
                    '--quiet',
                    '--output-document=' + filepath,
                    download_url
                ]
                
                print(f"[VOD DOWNLOAD] Starting download: {filename}")
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=3000) 