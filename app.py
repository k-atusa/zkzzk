from flask import Flask, render_template, jsonify, request, redirect, url_for, send_from_directory
from flask_sqlalchemy import SQLAlchemy
import os
import re
import requests
import subprocess
from datetime import datetime
import glob

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///streamers.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Streamer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_url = db.Column(db.String(200), unique=True, nullable=False)
    nickname = db.Column(db.String(100))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_checked = db.Column(db.DateTime)
    last_live = db.Column(db.DateTime)
    is_recording = db.Column(db.Boolean, default=False)
    current_broadcast_title = db.Column(db.String(200))
    process_id = db.Column(db.Integer)

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nid_aut = db.Column(db.String(200))
    nid_ses = db.Column(db.String(200))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Recording(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    streamer_id = db.Column(db.Integer, db.ForeignKey('streamer.id'), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    title = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    streamer = db.relationship('Streamer', backref=db.backref('recordings', lazy=True))

def extract_channel_id(url):
    # URL에서 채널 ID 추출 (16진수 32자리)
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
        # Create downloads directory if it doesn't exist
        if not os.path.exists('downloads'):
            os.makedirs('downloads')
            
        # Create streamer's directory
        streamer_dir = os.path.join('downloads', streamer_nickname)
        if not os.path.exists(streamer_dir):
            os.makedirs(streamer_dir)
            
        # Format filename: YYMMDD_HHMMSS <방송제목> [스트리머 닉네임].ts
        current_date = datetime.now().strftime('%y%m%d_%H%M%S')
        filename = f"{current_date} {broadcast_title} [{streamer_nickname}].ts"
        # Remove any invalid characters from filename
        filename = re.sub(r'[<>:"/\\|?*]', '', filename)
        filepath = os.path.join(streamer_dir, filename)
        
        # Get cookie values from Settings
        settings = Settings.query.first()
        if not settings or not settings.nid_aut or not settings.nid_ses:
            raise Exception("NID_AUT and NID_SES cookies are required for recording")
        
        # Construct streamlink command
        stream_url = f"https://chzzk.naver.com/live/{channel_id}"
        command = [
            'streamlink',
            '--ffmpeg-copyts',
            '--progress', 'no',
            '--http-cookie', f'NID_AUT={settings.nid_aut}',
            '--http-cookie', f'NID_SES={settings.nid_ses}',
            stream_url,
            'worst',
            '--output', filepath
        ]
        
        # Run streamlink in background
        process = subprocess.Popen(command)
        
        # Update streamer's recording status
        streamer = Streamer.query.get(streamer_id)
        if streamer:
            streamer.is_recording = True
            streamer.current_broadcast_title = broadcast_title
            streamer.process_id = process.pid
            
            # Create recording record
            recording = Recording(
                streamer_id=streamer_id,
                filename=os.path.join(streamer_nickname, filename),  # Store relative path
                title=broadcast_title
            )
            db.session.add(recording)
            db.session.commit()
            
        return True
    except Exception as e:
        print(f"Error downloading stream: {e}")
        return False

with app.app_context():
    db.create_all()

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
    # Get all recordings from downloads directory
    recordings = []
    if os.path.exists('downloads'):
        for root, dirs, files in os.walk('downloads'):
            for filename in files:
                if filename.endswith('.ts'):
                    filepath = os.path.join(root, filename)
                    # Get file creation time
                    created_at = datetime.fromtimestamp(os.path.getctime(filepath))
                    # Get relative path from downloads directory
                    rel_path = os.path.relpath(filepath, 'downloads')
                    # Extract streamer name from path
                    streamer_name = os.path.dirname(rel_path)
                    # Extract title from filename (format: YYMMDD_HHMMSS <title> [nickname].ts)
                    title = ' '.join(filename.split(' ')[1:-1])  # Remove date and nickname
                    
                    recordings.append({
                        'filename': rel_path,
                        'title': title,
                        'created_at': created_at,
                        'streamer_name': streamer_name
                    })
    
    # Group recordings by streamer
    streamer_recordings = {}
    for recording in recordings:
        if recording['streamer_name'] not in streamer_recordings:
            streamer_recordings[recording['streamer_name']] = []
        streamer_recordings[recording['streamer_name']].append(recording)
    
    # Sort recordings by creation time (newest first) for each streamer
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
        
        # Delete the file if it exists
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
    # response.raise_for_status()
    data = response.json()
    
    if data.get('code') != 200:
        return jsonify({'status': 'error', 'message': '치지직 이용 약관을 위반하여 정지된 채널입니다.'}), 400

    if not channel_url:
        return jsonify({'status': 'error', 'message': '채널 URL이 필요합니다.'}), 400

    # 채널 ID 추출
    channel_id = extract_channel_id(channel_url)
    if not channel_id:
        return jsonify({'status': 'error', 'message': '올바른 치지직 URL이 아닙니다.'}), 400

    # API에서 닉네임 가져오기
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
        
        # If recording, stop it first
        if streamer.is_recording and streamer.process_id:
            try:
                # Send SIGTERM to the process
                os.kill(streamer.process_id, 15)
                # Wait for the process to terminate
                os.waitpid(streamer.process_id, 0)
            except ProcessLookupError:
                # Process might have already terminated
                pass
        
        # Delete all recordings for this streamer
        Recording.query.filter_by(streamer_id=streamer_id).delete()
        
        # Delete the streamer
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
    
    # 채널 ID 추출
    channel_id = extract_channel_id(channel_url)
    if not channel_id:
        return jsonify({'status': 'error', 'message': '올바른 치지직 URL이 아닙니다.'}), 400

    try:
        # Check if cookies are set
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
            
            # DB 업데이트
            streamer = Streamer.query.filter_by(channel_url=channel_url).first()
            if streamer:
                streamer.last_checked = datetime.utcnow()
                if is_live:
                    streamer.last_live = datetime.utcnow()
                    # Start download only if not already recording
                    if not streamer.is_recording:
                        download_started = download_stream(channel_id, broadcast_title, streamer.nickname, streamer.id)
                else:
                    # Reset recording status when stream goes offline
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
                # Send SIGTERM to the process
                os.kill(streamer.process_id, 15)
                # Wait for the process to terminate
                os.waitpid(streamer.process_id, 0)
            except ProcessLookupError:
                # Process might have already terminated
                pass
            
            # Reset recording status
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
        print(f"Error stopping recording: {e}")
        return jsonify({
            'status': 'error',
            'message': '녹화 중지 중 오류가 발생했습니다.'
        }), 500

if __name__ == '__main__':
    app.run(debug=True, port=3000) 