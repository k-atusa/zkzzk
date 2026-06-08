from flask import Blueprint, request, render_template, redirect, url_for, session, g, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import pyotp
import qrcode
import io
import base64
import os
from core.models import User, Settings
from core.extensions import db

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/setup', methods=['GET', 'POST'])
def setup_admin():
    user_count = User.query.count()
    if user_count > 0:
        return redirect(url_for('main.live'))
    if request.method == 'POST':
        form = request.get_json(silent=True) or request.form
        username = form.get('username', '').strip()
        password = form.get('password', '').strip()
        if not username or not password:
            return render_template('login.html', error='관리자 사용자 생성: 사용자명과 비밀번호가 필요합니다.', setup_mode=True)
        if User.query.filter_by(username=username).first():
            return render_template('login.html', error='이미 존재하는 사용자명입니다.', setup_mode=True)
        user = User(username=username, password_hash=generate_password_hash(password), is_admin=True)
        downloads_dir = os.path.join(os.getcwd(), 'downloads')
        user_dir = os.path.join(downloads_dir, username)
        if not os.path.exists(user_dir):
            os.makedirs(user_dir, exist_ok=True)
        db.session.add(user)
        settings = Settings(initialized=True)
        db.session.add(settings)
        db.session.commit()
        session.permanent = True
        session['user_id'] = user.id
        return redirect(url_for('main.live'))
    return render_template('login.html', setup_mode=True)

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    settings_row = Settings.query.first()
    if (not settings_row or not settings_row.initialized) or User.query.count() == 0:
        return redirect(url_for('auth.setup_admin'))
    if request.method == 'POST':
        form = request.get_json(silent=True) or request.form
        username = form.get('username')
        password = form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            if user.totp_enabled and user.totp_secret:
                session.permanent = True
                session['pending_user_id'] = user.id
                return redirect(url_for('auth.login_otp'))
            session.permanent = True
            session['user_id'] = user.id
            return redirect(url_for('main.live'))
        return render_template('login.html', error='아이디 또는 비밀번호가 올바르지 않습니다.', setup_mode=False)
    return render_template('login.html', setup_mode=False)

@auth_bp.route('/login/otp', methods=['GET', 'POST'])
def login_otp():
    pending_id = session.get('pending_user_id')
    if not pending_id:
        return redirect(url_for('auth.login'))
    user = User.query.filter_by(id=pending_id).first()
    if request.method == 'POST':
        code = (request.get_json(silent=True) or request.form).get('otp')
        if user and user.totp_secret and pyotp.TOTP(user.totp_secret).verify(code, valid_window=1):
            session.pop('pending_user_id', None)
            session.permanent = True
            session['user_id'] = user.id
            return redirect(url_for('main.live'))
        return render_template('login.html', error='OTP가 올바르지 않습니다.', setup_mode=False)
    return render_template('login.html', error=None, setup_mode=False, otp_mode=True)

@auth_bp.route('/logout', methods=['POST', 'GET'])
def logout():
    session.clear()
    return redirect(url_for('auth.login'))

@auth_bp.route('/2fa/setup', methods=['POST'])
def twofa_setup():
    if not g.user:
        return jsonify({'status': 'error', 'message': '인증 필요'}), 401
    if g.user.totp_enabled:
        return jsonify({'status': 'error', 'message': '이미 2차인증이 활성화되어 있습니다.'}), 400
    secret = pyotp.random_base32()
    g.user.totp_secret = secret
    g.user.totp_enabled = False
    db.session.commit()
    issuer = 'ZKZZK'
    label = g.user.username
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=label, issuer_name=issuer)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf)
    data_url = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    return jsonify({'status': 'success', 'secret': secret, 'otpauth_url': uri, 'qrcode_data_url': data_url})

@auth_bp.route('/2fa/verify', methods=['POST'])
def twofa_verify():
    if not g.user:
        return jsonify({'status': 'error', 'message': '인증 필요'}), 401
    data = request.get_json() or request.form
    code = (data.get('otp') or '').strip()
    if not g.user.totp_secret:
        return jsonify({'status': 'error', 'message': '2차인증이 초기화되지 않았습니다.'}), 400
    totp = pyotp.TOTP(g.user.totp_secret)
    if totp.verify(code, valid_window=1):
        g.user.totp_enabled = True
        db.session.commit()
        return jsonify({'status': 'success', 'message': '2차인증이 활성화되었습니다.', 'enabled': True})
    return jsonify({'status': 'error', 'message': 'OTP가 올바르지 않습니다.'}), 400

@auth_bp.route('/2fa/disable', methods=['POST'])
def twofa_disable():
    if not g.user:
        return jsonify({'status': 'error', 'message': '인증 필요'}), 401
    g.user.totp_enabled = False
    g.user.totp_secret = None
    db.session.commit()
    return jsonify({'status': 'success', 'message': '2차인증이 비활성화되었습니다.', 'enabled': False})

@auth_bp.route('/2fa/status', methods=['GET'])
def twofa_status():
    if not g.user:
        return jsonify({'enabled': False}), 200
    return jsonify({'enabled': bool(g.user.totp_enabled), 'has_secret': bool(g.user.totp_secret)})
