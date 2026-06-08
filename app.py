import os
from flask import Flask, g, session, request, redirect, url_for
from core.extensions import db
from core.models import User, Settings, Streamer
from core.tasks import init_scheduler

from routes.auth import auth_bp
from routes.main import main_bp
from routes.streamers import streamers_bp
from routes.recordings import recordings_bp
from routes.vod import vod_bp
from routes.admin import admin_bp

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///streamers.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24))

db.init_app(app)

app.register_blueprint(auth_bp)
app.register_blueprint(main_bp)
app.register_blueprint(streamers_bp)
app.register_blueprint(recordings_bp)
app.register_blueprint(vod_bp)
app.register_blueprint(admin_bp)

@app.before_request
def load_user():
    g.user = None
    if 'user_id' in session:
        user = User.query.get(session['user_id'])
        if user:
            g.user = user

@app.before_request
def check_setup():
    if request.endpoint and request.endpoint.startswith('static'):
        return None
    try:
        settings_row = Settings.query.first()
        is_setup = settings_row and settings_row.initialized
        has_users = User.query.count() > 0
    except:
        is_setup = False
        has_users = False
    
    if not is_setup or not has_users:
        if request.endpoint != 'auth.setup_admin':
            return redirect(url_for('auth.setup_admin'))

with app.app_context():
    db.create_all()
    # Reset recording state
    streamers = Streamer.query.all()
    for s in streamers:
        s.is_recording = False
        s.current_broadcast_title = None
        s.process_id = None
    db.session.commit()

# Start scheduler
init_scheduler(app)

if __name__ == '__main__':
    if not os.path.exists('downloads'):
        os.makedirs('downloads')
    app.run(host='0.0.0.0', port=3000, debug=True)