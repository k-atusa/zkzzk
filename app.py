from flask import Flask, render_template, jsonify, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
import os
import re
import requests
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

with app.app_context():
    db.create_all()

@app.route('/')
def index():
    streamers = Streamer.query.filter_by(is_active=True).all()
    return render_template('index.html', streamers=streamers)

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
        if data.get('code') == 200 and data.get('content'):
            is_live = data['content'].get('status') == 'OPEN'
            
            # DB 업데이트
            streamer = Streamer.query.filter_by(channel_url=channel_url).first()
            if streamer:
                streamer.last_checked = datetime.utcnow()
                if is_live:
                    streamer.last_live = datetime.utcnow()
                db.session.commit()

        return jsonify({
            'status': 'success',
            'is_live': is_live,
            'message': '방송 상태를 확인했습니다.'
        })
    except Exception as e:
        print(f"Error checking status: {e}")
        return jsonify({'status': 'error', 'message': '방송 상태 확인 중 오류가 발생했습니다.'}), 500

if __name__ == '__main__':
    app.run(debug=True) 