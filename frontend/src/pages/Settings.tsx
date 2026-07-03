import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  ShieldCheck, ShieldAlert, KeyRound, Lock, Cookie,
  Users, Plus, Trash2, UserCheck, Loader2, CheckCircle2,
  Eye, EyeOff, ShieldQuestion, ZoomIn, Bell, MonitorPlay, Globe
} from 'lucide-react';
import api from '@/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useLanguage } from '../lib/i18n';

export const Settings = () => {
  const [user, setUser] = useState<any>(null);
  const { t, language, setLanguage } = useLanguage();

  const getCallbackUrl = () => {
    const apiBase = api.defaults.baseURL || 'http://localhost:5001/api';
    if (apiBase.startsWith('http')) {
      try {
        const url = new URL(apiBase);
        if (window.location.hostname && window.location.hostname !== 'localhost' && url.hostname === 'localhost') {
          url.hostname = window.location.hostname;
        }
        return `${url.origin}${url.pathname}/youtube/callback`;
      } catch (e) {
        return `${apiBase}/youtube/callback`;
      }
    }
    return `${window.location.origin}${apiBase}/youtube/callback`;
  };

  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    description: string | React.ReactNode;
    onConfirm: () => void;
    isDestructive?: boolean;
  } | null>(null);

  // System Settings
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [discordWebhookUseEmbed, setDiscordWebhookUseEmbed] = useState(true);
  const [youtubeClientId, setYoutubeClientId] = useState('');
  const [youtubeClientSecret, setYoutubeClientSecret] = useState('');
  const [showYoutubeClientSecret, setShowYoutubeClientSecret] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeAutoUpload, setYoutubeAutoUpload] = useState(true);
  const [deleteAfterUpload, setDeleteAfterUpload] = useState(false);

  // Resolution Settings
  const [liveResolution, setLiveResolution] = useState('1080p');
  const [vodResolution, setVodResolution] = useState('1080p');

  // UI Scale
  const [scale, setScale] = useState(() => {
    return parseInt(localStorage.getItem('ui_scale') || '100', 10);
  });

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    localStorage.setItem('ui_scale', String(newScale));
    document.documentElement.style.fontSize = `${newScale}%`;
    toast.success(t('settings.scaleSuccess', { scale: newScale }));
  };

  // 2FA
  const [qrCode, setQrCode] = useState('');
  const [otp, setOtp] = useState('');
  const [showSetup, setShowSetup] = useState(false);

  // Change Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // Cookies
  const [nidAut, setNidAut] = useState('');
  const [nidSes, setNidSes] = useState('');
  const [cookieLoading, setCookieLoading] = useState(false);
  const [cookieVerified, setCookieVerified] = useState<{ valid: boolean; nickname?: string } | null>(null);
  const [cookieSaveLoading, setCookieSaveLoading] = useState(false);

  // User Management (admin only)
  const [users, setUsers] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [userLoading, setUserLoading] = useState(false);

  const fetchMe = async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data);
      if (res.data.is_admin) {
        fetchUsers();
      }
      fetchUserSettings();
    } catch (e) {
      toast.error(t('settings.loadFailed'));
    }
  };

  const fetchUserSettings = async () => {
    try {
      const res = await api.get('/auth/user-settings');
      if (res.data.discord_webhook_url) setDiscordWebhookUrl(res.data.discord_webhook_url);
      if (res.data.discord_webhook_use_embed !== undefined) setDiscordWebhookUseEmbed(res.data.discord_webhook_use_embed);
      if (res.data.youtube_client_id) setYoutubeClientId(res.data.youtube_client_id);
      if (res.data.youtube_client_secret) setYoutubeClientSecret(res.data.youtube_client_secret);
      if (res.data.youtube_connected) setYoutubeConnected(true);
      if (res.data.youtube_auto_upload !== undefined) setYoutubeAutoUpload(res.data.youtube_auto_upload);
      if (res.data.delete_after_upload !== undefined) setDeleteAfterUpload(res.data.delete_after_upload);
      if (res.data.nid_aut) setNidAut(res.data.nid_aut);
      if (res.data.nid_ses) setNidSes(res.data.nid_ses);
      if (res.data.live_resolution) setLiveResolution(res.data.live_resolution);
      if (res.data.vod_resolution) setVodResolution(res.data.vod_resolution);
    } catch (e) { }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/auth/users');
      setUsers(res.data);
    } catch (e) { }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('youtube') === 'success') {
      const channelName = searchParams.get('channelName');
      toast.success(channelName
        ? t('settings.oauthSuccess', { name: channelName })
        : t('settings.oauthSuccessNoName')
      );
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (searchParams.get('youtube') === 'error') {
      toast.error(t('settings.oauthError'));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [t]);

  // 2FA handlers
  const handleSetup2FA = async () => {
    try {
      const res = await api.post('/auth/2fa/setup');
      setQrCode(res.data.qrcode_data_url);
      setShowSetup(true);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.otpSetupFailed'));
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/2fa/verify', { otp });
      toast.success(t('settings.otpEnabledSuccess'));
      setShowSetup(false);
      setOtp('');
      fetchMe();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.otpVerifyFailed'));
    }
  };

  const handleDisable2FA = () => {
    setConfirmConfig({
      title: t('settings.otpDisableConfirmTitle'),
      description: t('settings.otpDisableConfirmDesc'),
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.post('/auth/2fa/disable');
          toast.success(t('settings.otpDisabledSuccess'));
          fetchMe();
        } catch (error: any) {
          toast.error(error.response?.data?.message || t('settings.otpDisableFailed'));
        }
      }
    });
  };

  // Password Change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.passwordNotMatch'));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(t('settings.passwordTooShort'));
      return;
    }
    setPwLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success(t('settings.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.passwordChangeFailed'));
    } finally {
      setPwLoading(false);
    }
  };

  // Cookie handlers
  const handleVerifyCookies = async () => {
    if (!nidAut.trim() || !nidSes.trim()) {
      toast.error(t('settings.cookiesRequired'));
      return;
    }
    setCookieLoading(true);
    setCookieVerified(null);
    try {
      const res = await api.post('/auth/verify-cookies', { nid_aut: nidAut.trim(), nid_ses: nidSes.trim() });
      setCookieVerified(res.data);
      if (res.data.valid) {
        toast.success(t('settings.cookiesVerifiedSuccess', { name: res.data.nickname }));
      } else {
        toast.error(t('settings.cookiesVerifiedFailed'));
      }
    } catch (error: any) {
      toast.error(t('settings.cookiesVerifyError'));
      setCookieVerified({ valid: false });
    } finally {
      setCookieLoading(false);
    }
  };

  const handleSaveCookies = async (aut?: string, ses?: string) => {
    setCookieSaveLoading(true);
    try {
      await api.post('/auth/user-settings', {
        nid_aut: (aut ?? nidAut)?.trim() || null,
        nid_ses: (ses ?? nidSes)?.trim() || null
      });
      fetchMe();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.cookiesSaveFailed'));
    } finally {
      setCookieSaveLoading(false);
    }
  };

  const handleClearCookies = () => {
    setConfirmConfig({
      title: t('settings.cookiesClearConfirmTitle'),
      description: t('settings.cookiesClearConfirmDesc'),
      isDestructive: true,
      onConfirm: async () => {
        setCookieSaveLoading(true);
        try {
          await api.post('/auth/user-settings', { nid_aut: null, nid_ses: null });
          setNidAut('');
          setNidSes('');
          setCookieVerified(null);
          toast.success(t('settings.cookiesCleared'));
          fetchMe();
        } catch (error: any) {
          toast.error(t('settings.cookiesClearFailed'));
        } finally {
          setCookieSaveLoading(false);
        }
      }
    });
  };

  const handleSaveUserSettings = async (overrides: any = {}) => {
    try {
      await api.post('/auth/user-settings', {
        discord_webhook_url: discordWebhookUrl.trim(),
        discord_webhook_use_embed: discordWebhookUseEmbed,
        youtube_client_id: youtubeClientId.trim(),
        youtube_client_secret: youtubeClientSecret.trim(),
        youtube_auto_upload: youtubeAutoUpload,
        delete_after_upload: deleteAfterUpload,
        live_resolution: liveResolution,
        vod_resolution: vodResolution,
        ...overrides
      });
      fetchUserSettings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.webhookSaveFailed'));
    }
  };

  const handleYouTubeAuth = async () => {
    try {
      const res = await api.get('/youtube/auth-url');
      if (res.data.url) {
        window.location.href = res.data.url;
      }
    } catch (e: any) {
      toast.error(t('settings.getAuthUrlFailed'));
    }
  };

  // User Management
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newUserPass.trim()) return;
    setUserLoading(true);
    try {
      await api.post('/auth/users', { username: newUsername.trim(), password: newUserPass, is_admin: newUserIsAdmin });
      toast.success(t('settings.userAdded', { name: newUsername }));
      setNewUsername('');
      setNewUserPass('');
      setNewUserIsAdmin(false);
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.userAddFailed'));
    } finally {
      setUserLoading(false);
    }
  };

  const handleDeleteUser = (userId: string, username: string) => {
    setConfirmConfig({
      title: t('settings.userDeleteConfirmTitle'),
      description: t('settings.userDeleteConfirmDesc', { name: username }),
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.delete(`/auth/users/${userId}`);
          toast.success(t('settings.userDeleted', { name: username }));
          fetchUsers();
        } catch (error: any) {
          toast.error(error.response?.data?.message || t('settings.userDeleteFailed'));
        }
      }
    });
  };

  if (!user) return null;

  return (
    <div className="space-y-10 pb-10">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-2">{t('settings.title')}</h2>
        <p className="text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      {/* 1. 계정 및 보안 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Lock className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">{t('settings.secAccount')}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        {/* Password Change Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Lock className="mr-2 h-5 w-5" /> {t('settings.changePassword')}
            </CardTitle>
            <CardDescription>{t('settings.changePasswordDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">{t('settings.currentPassword')}</Label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder={t('settings.currentPasswordPlaceholder')}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCurrentPw(v => !v)}
                  >
                    {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t('settings.newPassword')}</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder={t('settings.newPasswordPlaceholder')}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowNewPw(v => !v)}
                  >
                    {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('settings.newPasswordConfirm')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('settings.newPasswordConfirmPlaceholder')}
                  required
                />
              </div>
              <Button type="submit" disabled={pwLoading}>
                {pwLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('settings.changePasswordBtn')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 2FA Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <KeyRound className="mr-2 h-5 w-5" /> {t('settings.twoFactorAuth')}
            </CardTitle>
            <CardDescription>{t('settings.twoFactorAuthDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showSetup && (
              <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                <div className="flex items-center space-x-4">
                  {user.totp_enabled ? <ShieldCheck className="h-6 w-6 text-green-500" /> : <ShieldAlert className="h-6 w-6 text-yellow-500" />}
                  <div>
                    <p className="font-medium">{user.totp_enabled ? t('settings.statusEnabled') : t('settings.statusDisabled')}</p>
                    <p className="text-sm text-muted-foreground">
                      {user.totp_enabled ? t('settings.enabledDesc') : t('settings.disabledDesc')}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={user.totp_enabled}
                  onCheckedChange={(checked) => checked ? handleSetup2FA() : handleDisable2FA()}
                />
              </div>
            )}

            {showSetup && (
              <div className="mt-0 p-4 border border-border rounded-lg bg-muted/40">
                <div className="flex flex-col xl:flex-row gap-4 items-center xl:items-start">
                  <div className="bg-white p-1.5 rounded-lg shrink-0">
                    <img src={qrCode} alt="QR Code" className="w-32 h-32" />
                  </div>
                  <div className="flex-1 w-full space-y-3">
                    <p className="text-xs text-muted-foreground leading-snug">
                      {t('settings.otpSetupModalDesc')}
                    </p>
                    <form onSubmit={handleVerify2FA} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="otp" className="text-xs">{t('login.otpCode')}</Label>
                        <Input
                          id="otp"
                          value={otp}
                          onChange={e => setOtp(e.target.value)}
                          placeholder="000000"
                          required
                          maxLength={6}
                          className="h-9"
                        />
                      </div>
                      <div className="flex space-x-2">
                        <Button type="submit" className="h-9 text-sm">{t('settings.verifyBtn')}</Button>
                        <Button type="button" variant="outline" className="h-9 text-sm" onClick={() => setShowSetup(false)}>{t('common.cancel')}</Button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </section>

      {/* 2. 화면 및 시스템 설정 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <MonitorPlay className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">{t('settings.secScreen')}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
      {/* 화면 배율 설정 Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ZoomIn className="h-5 w-5" /> {t('settings.uiScale')}
          </CardTitle>
          <CardDescription>
            {t('settings.uiScaleDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {[90, 100, 110, 120, 130].map((s) => (
              <Button
                key={s}
                variant={scale === s ? 'default' : 'outline'}
                onClick={() => handleScaleChange(s)}
                className="w-20"
              >
                {s}%
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Download Resolution Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorPlay className="h-5 w-5" /> {t('settings.downloadResolution')}
          </CardTitle>
          <CardDescription>{t('settings.downloadResolutionDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl">
            <div className="space-y-2">
              <Label htmlFor="liveResolution">{t('settings.liveResolution')}</Label>
              <select
                id="liveResolution"
                value={liveResolution}
                onChange={(e) => { setLiveResolution(e.target.value); handleSaveUserSettings({ live_resolution: e.target.value }); }}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="1080p">1080p ({language === 'ko' ? '기본' : 'Default'})</option>
                <option value="720p">720p</option>
                <option value="360p">360p</option>
                <option value="144p">144p</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">{t('settings.resolutionNotice')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vodResolution">{t('settings.vodResolution')}</Label>
              <select
                id="vodResolution"
                value={vodResolution}
                onChange={(e) => { setVodResolution(e.target.value); handleSaveUserSettings({ vod_resolution: e.target.value }); }}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="ask">{t('settings.vodAskEveryTime')}</option>
                <option value="1080p">1080p ({language === 'ko' ? '기본' : 'Default'})</option>
                <option value="720p">720p</option>
                <option value="360p">360p</option>
                <option value="144p">144p</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Language Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" /> {t('settings.language')}
          </CardTitle>
          <CardDescription>
            {t('settings.languageDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Button
              variant={language === 'en' ? 'default' : 'outline'}
              onClick={() => { setLanguage('en'); toast.success(t('settings.languageSuccess')); }}
              className="w-24"
            >
              English
            </Button>
            <Button
              variant={language === 'ko' ? 'default' : 'outline'}
              onClick={() => { setLanguage('ko'); toast.success(t('settings.languageSuccess')); }}
              className="w-24"
            >
              한국어
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
      </section>

      {/* 3. 외부 서비스 연동 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Bell className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">{t('settings.secExternal')}</h3>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pt-2 items-start">
          <div className="space-y-6">

      {/* Chzzk Cookie Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5" />
            {t('settings.chzzkCookies')}
            {user.has_cookies && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">
                <CheckCircle2 className="h-3 w-3" /> {language === 'ko' ? '연동됨' : 'Connected'}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {t('settings.chzzkCookiesDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4 max-w-lg">
            <div className="space-y-2">
              <Label htmlFor="nidAut">NID_AUT</Label>
              <Input
                id="nidAut"
                value={nidAut}
                onChange={e => { setNidAut(e.target.value); setCookieVerified(null); }}
                onBlur={e => handleSaveCookies(e.target.value, nidSes)}
                placeholder={t('settings.cookiesPlaceholder')}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nidSes">NID_SES</Label>
              <Input
                id="nidSes"
                value={nidSes}
                onChange={e => { setNidSes(e.target.value); setCookieVerified(null); }}
                onBlur={e => handleSaveCookies(nidAut, e.target.value)}
                placeholder={t('settings.cookiesPlaceholder')}
                className="font-mono text-sm"
              />
            </div>

            {/* Verification status */}
            {cookieVerified !== null && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${cookieVerified.valid
                ? 'bg-green-500/10 text-green-600 border border-green-500/20'
                : 'bg-red-500/10 text-red-500 border border-red-500/20'
                }`}>
                {cookieVerified.valid ? (
                  <>
                    <UserCheck className="h-4 w-4" />
                    {t('settings.cookiesVerifiedSuccess', { name: cookieVerified.nickname || '' })}
                  </>
                ) : (
                  <>
                    <ShieldQuestion className="h-4 w-4" />
                    {t('settings.cookiesVerifiedFailed')}
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleVerifyCookies} disabled={cookieLoading}>
                {cookieLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {t('settings.verifyCookies')}
              </Button>
              {user.has_cookies && (
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-500 border-red-500/50 hover:bg-red-500/10 hover:text-red-600"
                  onClick={handleClearCookies}
                  disabled={cookieSaveLoading}
                >
                  {t('settings.clearCookies')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Discord Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> {t('settings.discordWebhook')}
          </CardTitle>
          <CardDescription>{t('settings.discordWebhookDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="discordWebhookUrl">{t('settings.webhookUrl')}</Label>
              <Input
                id="discordWebhookUrl"
                value={discordWebhookUrl}
                onChange={e => setDiscordWebhookUrl(e.target.value)}
                onBlur={e => handleSaveUserSettings({ discord_webhook_url: e.target.value })}
                placeholder={t('settings.webhookUrlPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ko' ? '알림 메시지 형태' : 'Notification Format'}</Label>
              <div className="flex gap-4">
                <label className={`flex items-center justify-center px-4 py-2 border rounded-md cursor-pointer transition-colors ${discordWebhookUseEmbed ? 'bg-primary/10 border-primary text-primary' : 'border-input hover:bg-accent'}`}>
                  <input type="radio" className="hidden" checked={discordWebhookUseEmbed} onChange={() => { setDiscordWebhookUseEmbed(true); handleSaveUserSettings({ discord_webhook_use_embed: true }); }} />
                  <span className="text-sm font-medium">{language === 'ko' ? '카드 형태 (Embed)' : 'Rich Card (Embed)'}</span>
                </label>
                <label className={`flex items-center justify-center px-4 py-2 border rounded-md cursor-pointer transition-colors ${!discordWebhookUseEmbed ? 'bg-primary/10 border-primary text-primary' : 'border-input hover:bg-accent'}`}>
                  <input type="radio" className="hidden" checked={!discordWebhookUseEmbed} onChange={() => { setDiscordWebhookUseEmbed(false); handleSaveUserSettings({ discord_webhook_use_embed: false }); }} />
                  <span className="text-sm font-medium">{language === 'ko' ? '단순 텍스트 형태' : 'Simple Text'}</span>
                </label>
              </div>
            </div>

            {/* 디스코드 알림 미리보기 */}
            <div className="mt-4 p-4 bg-[#313338] text-[#dbdee1] rounded-md font-sans max-w-md shadow-inner text-sm border border-[#1e1f22]">
              <p className="text-xs text-[#949ba4] mb-3 uppercase font-bold tracking-wider">{language === 'ko' ? '미리보기' : 'Preview'}</p>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-[#5865F2] flex-shrink-0 flex items-center justify-center text-white font-bold text-lg">
                  Z
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-white text-[15px]">ZKZZK Bot</span>
                    <span className="text-[10px] bg-[#5865F2] text-white px-1 py-[1px] rounded leading-none flex items-center justify-center uppercase font-bold">Bot</span>
                    <span className="text-xs text-[#949ba4] font-medium ml-1">{language === 'ko' ? '오늘 오후 3:00' : 'Today at 3:00 PM'}</span>
                  </div>
                  {discordWebhookUseEmbed ? (
                    <div className="bg-[#2b2d31] border-l-4 border-blue-500 rounded p-3 mt-1.5 inline-block min-w-[250px]">
                      <p className="font-bold text-white text-base mb-1.5">🎥 {language === 'ko' ? '업로드 완료' : 'Upload Complete'}</p>
                      <div className="text-[13px] space-y-1">
                        <p>{language === 'ko' ? 'XXX님의 영상이 성공적으로 업로드되었습니다.' : "XXX's video has been successfully uploaded."}</p>
                        <p className="pt-1.5"><strong>{language === 'ko' ? '제목' : 'Title'}:</strong> {language === 'ko' ? '테스트 영상' : 'Test Video'}</p>
                        <p><strong>URL:</strong> <span className="text-[#00a8fc] cursor-pointer hover:underline">https://youtu.be/test</span></p>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-[15px] leading-relaxed mt-0.5">
                      <span className="font-bold">🎥 {language === 'ko' ? '업로드 완료' : 'Upload Complete'}</span>{'\n'}
                      {language === 'ko' ? '**XXX**님의 영상이 성공적으로 업로드되었습니다.' : "**XXX**'s video has been successfully uploaded."}{'\n\n'}
                      {language === 'ko' ? '제목' : 'Title'}: {language === 'ko' ? '테스트 영상' : 'Test Video'}{'\n'}
                      URL: <span className="text-[#00a8fc] cursor-pointer hover:underline">https://youtu.be/test</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </CardContent>
      </Card>
      </div>

      <div className="space-y-6">
      {/* YouTube Auto Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorPlay className="h-5 w-5" /> {t('settings.youtubeAutoUpload')}
          </CardTitle>
          <CardDescription>{t('settings.youtubeAutoUploadDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-6 mb-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="youtubeAutoUpload" className="text-sm font-medium cursor-pointer">{t('settings.autoUploadEnable')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.youtubeAutoUploadDesc')}</p>
              </div>
              <Switch
                id="youtubeAutoUpload"
                checked={youtubeAutoUpload}
                onCheckedChange={(val) => { setYoutubeAutoUpload(val); handleSaveUserSettings({ youtube_auto_upload: val }); }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="deleteAfterUpload" className="text-sm font-medium cursor-pointer">{t('settings.deleteAfterUpload')}</Label>
                <p className="text-xs text-muted-foreground">{t('recordings.deleteConfirmDesc')}</p>
              </div>
              <Switch
                id="deleteAfterUpload"
                checked={deleteAfterUpload}
                onCheckedChange={(val) => { setDeleteAfterUpload(val); handleSaveUserSettings({ delete_after_upload: val }); }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="youtubeClientId">{t('settings.clientId')}</Label>
            <Input
              id="youtubeClientId"
              value={youtubeClientId}
              onChange={e => setYoutubeClientId(e.target.value)}
              onBlur={e => handleSaveUserSettings({ youtube_client_id: e.target.value })}
              placeholder={t('settings.clientId')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="youtubeClientSecret">{t('settings.clientSecret')}</Label>
            <div className="relative">
              <Input
                id="youtubeClientSecret"
                value={youtubeClientSecret}
                onChange={e => setYoutubeClientSecret(e.target.value)}
                onBlur={e => handleSaveUserSettings({ youtube_client_secret: e.target.value })}
                placeholder={t('settings.clientSecret')}
                type={showYoutubeClientSecret ? 'text' : 'password'}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowYoutubeClientSecret(v => !v)}
              >
                {showYoutubeClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="text-xs text-muted-foreground mt-2 mb-2 p-3 bg-muted rounded-md space-y-3">
              <div>
                <p className="font-semibold mb-1 text-foreground">💡 {language === 'ko' ? '자동 업로드 설정 방법:' : 'How to configure Auto Upload:'}</p>
                <ol className="list-decimal pl-4 space-y-1">
                  {language === 'ko' ? (
                    <>
                      <li><a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">Google Cloud Console</a>에서 프로젝트를 생성합니다.</li>
                      <li><strong>YouTube Data API v3</strong>를 활성화합니다.</li>
                      <li>OAuth 동의 화면을 설정하고, <strong>웹 애플리케이션</strong> 유형의 사용자 인증 정보를 만듭니다.</li>
                      <li>승인된 리디렉션 URI에 <code className="select-all font-mono bg-muted px-1.5 py-0.5 rounded text-xs font-semibold text-primary border border-primary/10">{getCallbackUrl()}</code> 를 추가합니다.</li>
                      <li>발급받은 Client ID와 Client Secret을 위에 입력하고 <strong>저장</strong>을 누릅니다.</li>
                      <li><strong>YouTube 인증하기</strong> 버튼을 눌러 계정을 연동합니다.</li>
                    </>
                  ) : (
                    <>
                      <li>Create a project on the <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">Google Cloud Console</a>.</li>
                      <li>Enable <strong>YouTube Data API v3</strong>.</li>
                      <li>Configure the OAuth consent screen, and create credentials of type <strong>Web Application</strong>.</li>
                      <li>Add <code className="select-all font-mono bg-muted px-1.5 py-0.5 rounded text-xs font-semibold text-primary border border-primary/10">{getCallbackUrl()}</code> to the Authorized Redirect URIs.</li>
                      <li>Enter the Client ID and Client Secret above and save.</li>
                      <li>Click the <strong>Connect YouTube Channel</strong> button to authenticate.</li>
                    </>
                  )}
                </ol>
              </div>
              <div className="border-t border-border/60 pt-2.5">
                <p className="font-semibold mb-1 text-amber-600 dark:text-amber-500">⚠️ {language === 'ko' ? "'403 access_denied' (인증 절차 미완료) 오류 해결 방법:" : "How to fix '403 access_denied' errors:"}</p>
                <ul className="list-disc pl-4 space-y-1">
                  {language === 'ko' ? (
                    <>
                      <li>Google Cloud Console of <strong>Google 인증 플랫폼 &gt; 대상 &gt; OAuth 사용자 한도 &gt; 테스트 사용자</strong> 화면으로 이동합니다.</li>
                      <li>해당 화면에서 <strong>ADD USERS</strong>를 클릭하고, 인증하려는 Google 계정(이메일 주소)을 등록한 뒤 다시 시도해 주세요.</li>
                      <li>발급받은 <strong>API Key(OAuth 클라이언트)의 소유자 계정</strong>과 <strong>유튜브 인증을 진행하는 로그인 계정</strong>이 일치하는지 확인해 주세요.</li>
                      <li>또는 앱 게시 상태가 '테스트 중'이기 때문이므로 <strong>앱 게시 (Publish App)</strong>를 눌러 프로덕션으로 전환하셔도 무방합니다.</li>
                    </>
                  ) : (
                    <>
                      <li>Go to <strong>APIs & Services &gt; OAuth consent screen &gt; Test users</strong> in Google Cloud Console.</li>
                      <li>Click <strong>ADD USERS</strong>, register the Google email address you wish to authenticate, and try again.</li>
                      <li>Ensure that the owner account of the API client matches the account you use to authorize YouTube uploads.</li>
                      <li>Or, since the app status is in 'Testing', you can click <strong>Publish App</strong> to publish it to production to bypass testing limits.</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {youtubeClientId && youtubeClientSecret && (
              <Button variant={youtubeConnected ? "secondary" : "default"} onClick={handleYouTubeAuth}>
                {youtubeConnected ? t('settings.connectChannel') : t('settings.connectChannel')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
      </div>
      </section>

      {/* 4. 관리자 메뉴 */}
      {user.is_admin && (
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="text-xl font-semibold">{t('settings.userManagement')}</h3>
          </div>
          <div className="grid grid-cols-1 gap-6 pt-2">

      {/* User Management Card (Admin only) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> {t('settings.userManagement')}
              <span className="text-xs font-normal px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">{language === 'ko' ? '관리자 전용' : 'Admin Only'}</span>
            </CardTitle>
            <CardDescription>{t('settings.userManagementDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add User Form */}
            <div className="p-4 border border-border rounded-lg bg-muted/20">
              <h4 className="font-medium mb-3 text-sm">{t('settings.addUser')}</h4>
              <form onSubmit={handleCreateUser} className="space-y-3">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1.5 flex-1 min-w-32">
                    <Label htmlFor="newUsername" className="text-xs">{t('login.username')}</Label>
                    <Input
                      id="newUsername"
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder={t('login.username')}
                      required
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-32">
                    <Label htmlFor="newUserPass" className="text-xs">{t('login.password')}</Label>
                    <Input
                      id="newUserPass"
                      type="password"
                      value={newUserPass}
                      onChange={e => setNewUserPass(e.target.value)}
                      placeholder={t('settings.newPasswordPlaceholder')}
                      required
                      className="h-9"
                    />
                  </div>
                  <div className="flex items-center gap-2 h-9">
                    <Switch
                      id="newUserIsAdmin"
                      checked={newUserIsAdmin}
                      onCheckedChange={setNewUserIsAdmin}
                    />
                    <Label htmlFor="newUserIsAdmin" className="text-sm cursor-pointer">{t('layout.admin')}</Label>
                  </div>
                  <Button type="submit" disabled={userLoading} className="h-9">
                    {userLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                    {t('settings.addUserBtn')}
                  </Button>
                </div>
              </form>
            </div>

            {/* User List */}
            <div className="space-y-2">
              {users.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground text-sm">{t('common.loading')}</p>
              ) : (
                users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
                        {u.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{u.username}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {u.is_admin && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">{t('layout.admin')}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {u.created_at ? new Date(u.created_at).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US') : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                    {u.id !== user.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteUser(u.id, u.username)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    {u.id === user.id && (
                      <span className="text-xs text-muted-foreground px-2 py-1">{language === 'ko' ? '나' : 'Me'}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        </div>
        </section>
      )}

      <Dialog open={!!confirmConfig} onOpenChange={(open) => { if (!open) setConfirmConfig(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmConfig?.title}</DialogTitle>
            <DialogDescription>
              {confirmConfig?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmConfig(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant={confirmConfig?.isDestructive ? "destructive" : "default"} onClick={() => {
              confirmConfig?.onConfirm();
              setConfirmConfig(null);
            }}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
