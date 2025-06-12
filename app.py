from flask import Flask, render_template, jsonify, request, redirect, url_for, send_from_directory
from flask_sqlalchemy import SQLAlchemy
import os
import re
import requests
import subprocess
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
import pytz

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
                    created_at = datetime.fromtimestamp(os.path.getctime(filepath))
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
    channel_url = data.get('channel_url')
    
    channel_id = extract_channel_id(channel_url)
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
        
        if data.get('code') == 200 and data.get('content'):
            is_live = data['content'].get('status') == 'OPEN'
            broadcast_title = data['content'].get('liveTitle')
            
            streamer = Streamer.query.filter_by(channel_url=channel_url).first()
            if streamer:
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
            'is_recording': streamer.is_recording if streamer else False,
            'download_started': download_started,
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=3000) 