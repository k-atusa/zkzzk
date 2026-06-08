from flask import Blueprint, render_template, g, jsonify, redirect, url_for, send_from_directory
import os
import re
from datetime import datetime
from core.utils import can_access_recording_path

recordings_bp = Blueprint('recordings', __name__)

@recordings_bp.route('/recordings')
def recordings():
    if not g.user:
        return redirect(url_for('auth.login'))

    recordings = []
    user_downloads_dir = os.path.join('downloads', g.user.username)
    if os.path.exists(user_downloads_dir):
        for root, dirs, files in os.walk(user_downloads_dir):
            for filename in files:
                if filename.endswith('.ts') or filename.endswith('.mp4'):
                    filepath = os.path.join(root, filename)
                    created_at = datetime.fromtimestamp(os.path.getctime(filepath), tz=datetime.now().tzinfo)
                    rel_path = os.path.relpath(filepath, 'downloads').replace(os.sep, '/')
                    rel_to_user = os.path.relpath(filepath, user_downloads_dir)
                    parts = rel_to_user.split(os.sep)
                    if len(parts) >= 3:
                        category = parts[0]
                        streamer_folder = parts[1]
                        if category == 'live':
                            streamer_name = f"{streamer_folder} (라이브)"
                        elif category == 'vod':
                            streamer_name = f"{streamer_folder} (다시보기)"
                        else:
                            streamer_name = f"{streamer_folder} ({category})"
                    elif len(parts) == 2:
                        if parts[0] == 'vod':
                            streamer_name = '다시보기 (기존)'
                        else:
                            streamer_name = parts[0]
                    else:
                        streamer_name = '기타'
                    file_size = os.path.getsize(filepath)
                    
                    match = re.match(r'^\d{6}_\d{6} (.+) \[.+\]\.(ts|mp4)$', filename)
                    title = match.group(1) if match else filename

                    recordings.append({
                        'display_name': filename,
                        'filename': rel_path,
                        'title': title,
                        'created_at': created_at,
                        'streamer_name': streamer_name,
                        'size_mb': round(file_size / (1024 * 1024), 2)
                    })

    streamer_recordings = {}
    for recording in recordings:
        if recording['streamer_name'] not in streamer_recordings:
            streamer_recordings[recording['streamer_name']] = []
        streamer_recordings[recording['streamer_name']].append(recording)

    for streamer_name in streamer_recordings:
        streamer_recordings[streamer_name].sort(key=lambda x: x['created_at'], reverse=True)

    return render_template('recordings.html', streamer_recordings=streamer_recordings, current_page='recordings')


@recordings_bp.route('/play_recording/<path:filename>')
def play_recording(filename):
    if not can_access_recording_path(filename):
        return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403

    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in ('.mp4', '.ts'):
        return redirect(url_for('recordings.recordings'))

    return render_template(
        'recording_player.html',
        filename=filename,
        file_name=os.path.basename(filename),
        file_ext=file_ext,
        current_page='recordings'
    )

@recordings_bp.route('/recordings/<path:filename>')
def serve_recording(filename):
    if not can_access_recording_path(filename):
        return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403
    return send_from_directory('downloads', filename)

@recordings_bp.route('/delete_recording/<path:filename>', methods=['POST'])
def delete_recording(filename):
    try:
        if not can_access_recording_path(filename):
            return jsonify({'status': 'error', 'message': '권한이 없습니다.'}), 403

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
