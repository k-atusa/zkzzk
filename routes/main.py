from flask import Blueprint, render_template, g, request, jsonify, redirect, url_for
from werkzeug.security import generate_password_hash
from core.models import Streamer, User
from core.extensions import db

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    return redirect(url_for('main.live'))

@main_bp.route('/live')
def live():
    user = g.user
    streamers = Streamer.query.filter_by(is_active=True, user_id=user.id).all()
    return render_template('index.html', streamers=streamers, current_page='live')

@main_bp.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'POST':
        data = request.get_json()
        nid_aut = data.get('nid_aut')
        nid_ses = data.get('nid_ses')

        g.user.nid_aut = nid_aut
        g.user.nid_ses = nid_ses

        db.session.commit()

        return jsonify({
            'status': 'success',
            'message': '설정이 저장되었습니다.'
        })

    if not g.user:
        return redirect(url_for('auth.login'))
    
    if request.headers.get('Content-Type') == 'application/json' or 'application/json' in request.headers.get('Accept', ''):
        return jsonify({
            'nid_aut': g.user.nid_aut,
            'nid_ses': g.user.nid_ses
        })
    
    return render_template('profile.html')

@main_bp.route('/profile', methods=['GET', 'POST'])
def profile():
    if not g.user:
        return redirect(url_for('auth.login'))
    if request.method == 'POST':
        data = request.get_json() or request.form
        new_password = data.get('new_password', '').strip()
        if new_password:
            g.user.password_hash = generate_password_hash(new_password)
            db.session.commit()
            return jsonify({'status': 'success', 'message': '비밀번호가 변경되었습니다.'})
        return jsonify({'status': 'error', 'message': '새 비밀번호를 입력하세요.'}), 400
    return render_template('profile.html')
