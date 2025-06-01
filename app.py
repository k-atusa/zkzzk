from flask import Flask, render_template, jsonify, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
import os
import re
import requests
import subprocess
from datetime import datetime

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
            
        # Format filename: YYMMDD_HHMMSS <방송제목> [스트리머 닉네임].ts
        current_date = datetime.now().strftime('%y%m%d_%H%M%S')
        filename = f"{current_date} {broadcast_title} [{streamer_nickname}].ts"
        # Remove any invalid characters from filename
        filename = re.sub(r'[<>:"/\\|?*]', '', filename)
        filepath = os.path.join('downloads', filename)
        
        # Construct streamlink command
        stream_url = f"https://chzzk.naver.com/live/{channel_id}"
        command = [
            'streamlink',
            '--ffmpeg-copyts',
            '--progress', 'no',
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
            db.session.commit()
            
        return True
    except Exception as e:
        print(f"Error downloading stream: {e}")
        return False

with app.app_context():
    db.create_all()

@app.route('/')
def index():
    streamers = Streamer.query.filter_by(is_active=True).all()
    settings = Settings.query.first()
    return render_template('index.html', streamers=streamers, settings=settings)

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
    data = request.get_json()
    channel_url = data.get('channel_url')

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
    streamer = Streamer.query.get_or_404(streamer_id)
    db.session.delete(streamer)
    db.session.commit()
    return jsonify({'status': 'success', 'message': '스트리머가 제거되었습니다.'})

@app.route('/check_status', methods=['POST'])
def check_status():
    data = request.get_json()
    channel_url = data.get('channel_url')
    
    # 채널 ID 추출
    channel_id = extract_channel_id(channel_url)
    if not channel_id:
        return jsonify({'status': 'error', 'message': '올바른 치지직 URL이 아닙니다.'}), 400

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