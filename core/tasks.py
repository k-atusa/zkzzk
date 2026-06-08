import os
import re
import subprocess
from datetime import datetime
import requests
import threading
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from core.extensions import db
from core.models import Streamer, User, Recording
from core.utils import extract_channel_id

def download_stream(app, channel_id, broadcast_title, streamer_nickname, streamer_id):
    try:
        # Get the streamer to determine which user's directory to use
        streamer = Streamer.query.filter_by(id=streamer_id).first()
        if not streamer:
            raise Exception("스트리머를 찾을 수 없습니다")
        
        # Get the streamer owner's user info
        streamer_owner = User.query.filter_by(id=streamer.user_id).first()
        if not streamer_owner or not streamer_owner.username:
            raise Exception("스트리머 소유자 정보를 찾을 수 없습니다.")

        user_downloads_dir = os.path.join('downloads', streamer_owner.username)
        if not os.path.exists(user_downloads_dir):
            os.makedirs(user_downloads_dir)

        streamer_dir = os.path.join(user_downloads_dir, 'live', streamer_nickname)
        if not os.path.exists(streamer_dir):
            os.makedirs(streamer_dir)

        current_date = datetime.now().strftime('%y%m%d_%H%M%S')
        filename = f"{current_date} {broadcast_title} [{streamer_nickname}].ts"
        filename = re.sub(r'[<>:"/\\|?*]', '', filename)
        filepath = os.path.join(streamer_dir, filename)
        
        # Use cookie_user_id if set, otherwise use the streamer owner's cookies
        cookie_user_id = streamer.cookie_user_id if streamer.cookie_user_id else streamer.user_id
        cookie_user = User.query.filter_by(id=cookie_user_id).first()
        if not cookie_user or not cookie_user.nid_aut or not cookie_user.nid_ses:
            raise Exception("NID_AUT and NID_SES cookies are required for recording")
        
        stream_url = f"https://chzzk.naver.com/live/{channel_id}"
        command = [
            'streamlink',
            '--ffmpeg-copyts',
            '--progress', 'no',
            '--http-cookie', f'NID_AUT={cookie_user.nid_aut}',
            '--http-cookie', f'NID_SES={cookie_user.nid_ses}',
            stream_url,
            '720p',
            '--output', filepath
        ]
        
        process = subprocess.Popen(command)
        
        if streamer:
            streamer.is_recording = True
            streamer.current_broadcast_title = broadcast_title
            streamer.process_id = process.pid
            
            recording = Recording(
                streamer_id=streamer_id,
                user_id=streamer.user_id,
                filename=os.path.join('live', streamer_nickname, filename),
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
                        recording.filename = os.path.join('live', streamer_nickname, mp4_filename)
                        db.session.commit()
                except Exception as e:
                    print(f"Error converting to MP4: {e}")
            
            threading.Thread(target=convert_to_mp4, daemon=True).start()
            
        return True
    except Exception as e:
        print(f"Error downloading stream: {e}")
        return False

def check_all_streamers(app):
    with app.app_context():
        streamers = Streamer.query.filter_by(is_active=True).all()
        for streamer in streamers:
            channel_id = extract_channel_id(streamer.channel_url)
            if not channel_id:
                continue

            try:
                cookie_user_id = streamer.cookie_user_id if streamer.cookie_user_id else streamer.user_id
                cookie_user = User.query.filter_by(id=cookie_user_id).first()
                if not cookie_user or not cookie_user.nid_aut or not cookie_user.nid_ses:
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
                            download_stream(app, channel_id, broadcast_title, streamer.nickname, streamer.id)
                    else:
                        streamer.is_recording = False
                        streamer.current_broadcast_title = None
                    db.session.commit()

            except Exception as e:
                print(f"Error checking streamer {streamer.nickname}: {e}")

def init_scheduler(app):
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        func=check_all_streamers,
        args=[app],
        trigger=IntervalTrigger(seconds=30),
        id='check_streamers',
        name='Check all streamers status',
        replace_existing=True
    )
    scheduler.start()
