from flask import Blueprint, request, jsonify, render_template, g, redirect, url_for
from werkzeug.security import generate_password_hash
import os
from core.models import User
from core.extensions import db

admin_bp = Blueprint('admin', __name__)

@admin_bp.route('/admin/users', methods=['GET', 'POST', 'DELETE'])
def admin_users():
    if not g.user or not g.user.is_admin:
        return redirect(url_for('main.live'))
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
        downloads_dir = os.path.join(os.getcwd(), 'downloads')
        user_dir = os.path.join(downloads_dir, username)
        if not os.path.exists(user_dir):
            os.makedirs(user_dir, exist_ok=True)
        db.session.add(user)
        db.session.commit()
        return jsonify({'status': 'success'})
    if request.method == 'DELETE':
        data = request.get_json() or {}
        user_id = int(data.get('user_id') or 0)
        if user_id == g.user.id:
            return jsonify({'status': 'error', 'message': '본인 삭제 불가'}), 400
        user = User.query.filter_by(id=user_id).first()
        if not user:
            return jsonify({'status': 'error', 'message': '사용자를 찾을 수 없습니다.'}), 404
        db.session.delete(user)
        db.session.commit()
        return jsonify({'status': 'success'})
