from datetime import datetime
from core.extensions import db

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now())
    totp_secret = db.Column(db.String(64))
    totp_enabled = db.Column(db.Boolean, default=False)
    nid_aut = db.Column(db.String(200))
    nid_ses = db.Column(db.String(200))

class Streamer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_url = db.Column(db.String(200), nullable=False)
    nickname = db.Column(db.String(100))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    cookie_user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now())
    last_checked = db.Column(db.DateTime)
    last_live = db.Column(db.DateTime)
    is_recording = db.Column(db.Boolean, default=False)
    current_broadcast_title = db.Column(db.String(200))
    process_id = db.Column(db.Integer)
    user = db.relationship('User', backref=db.backref('streamers', lazy=True), foreign_keys=[user_id])
    cookie_user = db.relationship('User', backref=db.backref('cookie_streamers', lazy=True), foreign_keys=[cookie_user_id])
    __table_args__ = (db.UniqueConstraint('user_id', 'channel_url', name='unique_user_channel'),)

class Recording(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    streamer_id = db.Column(db.Integer, db.ForeignKey('streamer.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    filename = db.Column(db.String(200), nullable=False)
    title = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=lambda: datetime.now())
    streamer = db.relationship('Streamer', backref=db.backref('recordings', lazy=True))
    user = db.relationship('User', backref=db.backref('recordings', lazy=True))

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    initialized = db.Column(db.Boolean, default=False)
