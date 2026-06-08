from flask import Blueprint, request, jsonify, g, current_app
import os
import requests
from datetime import datetime
from core.models import Streamer, User, Recording
from core.extensions import db
from core.utils import extract_channel_id, get_channel_info
from core.tasks import download_stream

streamers_bp = Blueprint('streamers', __name__)

@streamers_bp.route('/add_streamer', methods=['POST'])
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

    existing_streamer = Streamer.query.filter_by(user_id=user.id, channel_url=channel_url).first()
    if existing_streamer:
        return jsonify({'status': 'error', 'message': '이미 등록된 채널입니다.'}), 400

    try:
        streamer = Streamer(channel_url=channel_url, nickname=nickname, user_id=user.id, cookie_user_id=user.id)
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
        print(f"Error adding streamer: {e}")
        return jsonify({'status': 'error', 'message': '스트리머 추가 중 오류가 발생했습니다.'}), 500

@streamers_bp.route('/remove_streamer/<int:streamer_id>', methods=['POST'])
def remove_streamer(streamer_id):
    try:
        user = g.user
        streamer = Streamer.query.filter_by(id=streamer_id).first()
        if not streamer:
            return jsonify({'status': 'error', 'message': '스트리머를 찾을 수 없습니다.'}), 404
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

@streamers_bp.route('/check_status', methods=['POST'])
def check_status():
    data = request.get_json()
    streamer_id = data.get('streamer_id')
    
    streamer = Streamer.query.filter_by(id=streamer_id).first()
    if not streamer:
        return jsonify({'status': 'error', 'message': '스트리머를 찾을 수 없습니다.'}), 400
    if g.user and (streamer.user_id != g.user.id) and not g.user.is_admin:
        return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403

    channel_id = extract_channel_id(streamer.channel_url)
    if not channel_id:
        return jsonify({'status': 'error', 'message': '올바른 치지직 URL이 아닙니다.'}), 400

    try:
        cookie_user_id = streamer.cookie_user_id if streamer.cookie_user_id else streamer.user_id
        cookie_user = User.query.filter_by(id=cookie_user_id).first()
        if not cookie_user or not cookie_user.nid_aut or not cookie_user.nid_ses:
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
                    download_started = download_stream(current_app._get_current_object(), channel_id, broadcast_title, streamer.nickname, streamer.id)
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

@streamers_bp.route('/stop_recording/<int:streamer_id>', methods=['POST'])
def stop_recording(streamer_id):
    try:
        streamer = Streamer.query.filter_by(id=streamer_id).first()
        if not streamer:
            return jsonify({'status': 'error', 'message': '스트리머를 찾을 수 없습니다.'}), 404
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

@streamers_bp.route('/set_streamer_cookies', methods=['POST'])
def set_streamer_cookies():
    try:
        data = request.get_json()
        streamer_id = data.get('streamer_id')
        cookie_user_id = data.get('cookie_user_id')
        
        streamer = Streamer.query.filter_by(id=streamer_id).first()
        if not streamer:
            return jsonify({'status': 'error', 'message': '스트리머를 찾을 수 없습니다.'}), 404
        if streamer.user_id != g.user.id and not g.user.is_admin:
            return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403
        
        if cookie_user_id:
            cookie_user = User.query.filter_by(id=cookie_user_id).first()
            if not cookie_user:
                return jsonify({'status': 'error', 'message': '쿠키 사용자를 찾을 수 없습니다.'}), 400
            
            if not cookie_user.nid_aut or not cookie_user.nid_ses:
                return jsonify({'status': 'error', 'message': '해당 사용자의 쿠키가 설정되지 않았습니다.'}), 400
        
        streamer.cookie_user_id = cookie_user_id
        db.session.commit()
        
        return jsonify({
            'status': 'success',
            'message': '스트리머 쿠키 설정이 업데이트되었습니다.'
        })
    except Exception as e:
        db.session.rollback()
        print(f"Error setting streamer cookies: {e}")
        return jsonify({
            'status': 'error',
            'message': '스트리머 쿠키 설정 중 오류가 발생했습니다.'
        }), 500

@streamers_bp.route('/get_users_with_cookies', methods=['GET'])
def get_users_with_cookies():
    try:
        users_with_cookies = []
        users = User.query.all()
        
        for user in users:
            if user.nid_aut and user.nid_ses:
                users_with_cookies.append({
                    'id': user.id,
                    'username': user.username
                })
        
        return jsonify({
            'status': 'success',
            'users': users_with_cookies
        })
    except Exception as e:
        print(f"Error getting users with cookies: {e}")
        return jsonify({
            'status': 'error',
            'message': '사용자 목록을 가져오는 중 오류가 발생했습니다.'
        }), 500
