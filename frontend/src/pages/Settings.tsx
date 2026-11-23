import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  ShieldCheck, KeyRound, Lock, Cookie,
  Users, Plus, Trash2, UserCheck, Loader2, CheckCircle2, XCircle, X,
  Eye, EyeOff, ShieldQuestion, ZoomIn, Bell, MonitorPlay, Globe
} from 'lucide-react';
import api from '@/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useLanguage } from '../lib/i18n';

export const Settings = () => {
  const [user, setUser] = useState<any>(null);
  const { t, language, setLanguage } = useLanguage();



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
  const [youtubeChannelTitle, setYoutubeChannelTitle] = useState('');
  const [showYoutubeInputs, setShowYoutubeInputs] = useState(false);
  const [youtubeAutoUpload, setYoutubeAutoUpload] = useState(true);
  const [youtubePrivacyStatus, setYoutubePrivacyStatus] = useState<'public' | 'unlisted' | 'private'>('unlisted');
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
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Cookies
  const [nidAut, setNidAut] = useState('');
  const [nidSes, setNidSes] = useState('');
  const [chzzkNickname, setChzzkNickname] = useState('');
  const [showCookieInputs, setShowCookieInputs] = useState(false);
  const [cookieVerified, setCookieVerified] = useState<{ valid: boolean; nickname?: string } | null>(null);
  const [cookieSaveLoading, setCookieSaveLoading] = useState(false);

  // User Management (admin only)
  const [users, setUsers] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [userLoading, setUserLoading] = useState(false);
  const [showAddUserForm, setShowAddUserForm] = useState(false);

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
      if (res.data.youtube_channel_title) setYoutubeChannelTitle(res.data.youtube_channel_title);
      if (res.data.youtube_auto_upload !== undefined) setYoutubeAutoUpload(res.data.youtube_auto_upload);
      if (res.data.youtube_privacy_status) setYoutubePrivacyStatus(res.data.youtube_privacy_status);
      if (res.data.delete_after_upload !== undefined) setDeleteAfterUpload(res.data.delete_after_upload);
      if (res.data.nid_aut) setNidAut(res.data.nid_aut);
      if (res.data.nid_ses) setNidSes(res.data.nid_ses);
      if (res.data.chzzk_nickname) setChzzkNickname(res.data.chzzk_nickname);
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
      if (channelName) setYoutubeChannelTitle(channelName);
      toast.success(channelName
        ? t('settings.oauthSuccess', { name: channelName })
        : t('settings.oauthSuccessNoName')
      );
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchUserSettings();
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
      setShowPasswordForm(false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.passwordChangeFailed'));
    } finally {
      setPwLoading(false);
    }
  };

  // Cookie handlers
  const handleSaveCookiesSubmit = async () => {
    if (!nidAut.trim() || !nidSes.trim()) {
      toast.error(t('settings.cookiesRequired'));
      return;
    }
    setCookieSaveLoading(true);
    setCookieVerified(null);
    try {
      const verifyRes = await api.post('/auth/verify-cookies', { nid_aut: nidAut.trim(), nid_ses: nidSes.trim() });
      if (verifyRes.data?.valid) {
        setCookieVerified(verifyRes.data);
        const name = verifyRes.data.nickname || '';
        setChzzkNickname(name);
        await api.post('/auth/user-settings', { nid_aut: nidAut.trim(), nid_ses: nidSes.trim(), chzzk_nickname: name });
        toast.success(t('settings.cookiesVerifiedSuccess', { name }));
        setShowCookieInputs(false);
        fetchMe();
        fetchUserSettings();
      } else {
        setCookieVerified({ valid: false });
        toast.error(t('settings.cookiesVerifiedFailed'));
      }
    } catch (error: any) {
      setCookieVerified({ valid: false });
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
          await api.post('/auth/user-settings', { nid_aut: null, nid_ses: null, chzzk_nickname: null });
          setNidAut('');
          setNidSes('');
          setChzzkNickname('');
          setCookieVerified(null);
          setShowCookieInputs(false);
          toast.success(t('settings.cookiesCleared'));
          fetchMe();
          fetchUserSettings();
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
        youtube_privacy_status: youtubePrivacyStatus,
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

  const handleSaveYoutubeSettingsSubmit = async () => {
    if (!youtubeClientId.trim() || !youtubeClientSecret.trim()) {
      toast.error(language === 'ko' ? '클라이언트 ID와 비밀번호를 모두 입력해 주세요.' : 'Please enter both Client ID and Secret.');
      return;
    }
    try {
      await api.post('/auth/user-settings', {
        youtube_client_id: youtubeClientId.trim(),
        youtube_client_secret: youtubeClientSecret.trim(),
      });
      const res = await api.get('/youtube/auth-url');
      if (res.data.url) {
        window.location.href = res.data.url;
      } else {
        toast.error(t('settings.getAuthUrlFailed'));
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('settings.webhookSaveFailed'));
    }
  };

  const handleDisconnectYoutube = () => {
    setConfirmConfig({
      title: t('settings.disconnectConfirmTitle') || 'YouTube 연동 해제',
      description: t('settings.disconnectConfirmDesc') || 'YouTube 채널 연동을 해제하시겠습니까?',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.post('/auth/user-settings', { disconnect_youtube: true });
          setYoutubeClientId('');
          setYoutubeClientSecret('');
          setYoutubeConnected(false);
          setYoutubeChannelTitle('');
          setShowYoutubeInputs(false);
          toast.success(t('settings.disconnectSuccess') || 'YouTube 연동이 해제되었습니다.');
          fetchUserSettings();
        } catch (e) {
          toast.error(t('settings.disconnectFailed') || '연동 해제 실패');
        }
      }
    });
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
      setShowAddUserForm(false);
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
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('settings.title')}</h2>
      </div>

      {/* 1. 계정 및 보안 */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 pb-2.5 border-b border-border">
          <Lock className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">{t('settings.secAccount')}</h3>
        </div>

        <div className="divide-y divide-border/60">
          {/* Password Change */}
          <div className="py-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
                <Lock className="h-4 w-4 text-muted-foreground" />
                {t('settings.changePassword')}
              </h4>
              {!showPasswordForm && (
                <Button
                  type="button"
                  onClick={() => setShowPasswordForm(true)}
                  className="shrink-0 px-4"
                >
                  <Lock className="h-4 w-4 mr-1.5" />
                  {t('settings.changePasswordBtn')}
                </Button>
              )}
            </div>

            {showPasswordForm && (
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-lg pt-1 animate-in fade-in-50 duration-200">
                <div className="space-y-1.5">
                  <Label htmlFor="currentPassword" className="text-xs font-medium">{t('settings.currentPassword')}</Label>
                  <div className="relative">
                    <Input
                      id="currentPassword"
                      type={showCurrentPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder={t('settings.currentPasswordPlaceholder')}
                      required
                      className="pr-10 bg-background"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                      onClick={() => setShowCurrentPw(v => !v)}
                    >
                      {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="newPassword" className="text-xs font-medium">{t('settings.newPassword')}</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder={t('settings.newPasswordPlaceholder')}
                      required
                      className="pr-10 bg-background"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                      onClick={() => setShowNewPw(v => !v)}
                    >
                      {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className="text-xs font-medium">{t('settings.newPasswordConfirm')}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder={t('settings.newPasswordConfirmPlaceholder')}
                    required
                    className="bg-background"
                  />
                  {confirmPassword && (
                    <div className="pt-1">
                      {newPassword !== confirmPassword ? (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" />
                          {language === 'ko' ? '비밀번호가 일치하지 않습니다.' : 'Passwords do not match.'}
                        </p>
                      ) : (
                        <p className="text-xs text-green-600 dark:text-green-500 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {language === 'ko' ? '비밀번호가 일치합니다.' : 'Passwords match.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setShowPasswordForm(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" disabled={pwLoading}>
                    {pwLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                    {t('settings.changePasswordBtn')}
                  </Button>
                </div>
              </form>
            )}
          </div>

          {/* 2FA */}
          <div className="py-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  {t('settings.twoFactorAuth')}
                </h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${user?.totp_enabled
                  ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                  : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                  }`}>
                  {user?.totp_enabled ? (language === 'ko' ? '보호 중' : 'Protected') : (language === 'ko' ? '미설정' : 'Unset')}
                </span>
              </div>
              {!showSetup && (
                <Button
                  variant={user?.totp_enabled ? 'outline' : 'default'}
                  onClick={() => user?.totp_enabled ? handleDisable2FA() : handleSetup2FA()}
                  className={user?.totp_enabled ? 'text-destructive border-destructive/50 hover:bg-destructive/10 shrink-0 px-4' : 'shrink-0 px-4'}
                >
                  <KeyRound className="h-4 w-4 mr-1.5" />
                  {user?.totp_enabled ? (language === 'ko' ? '2차 인증 해제' : 'Disable 2FA') : (language === 'ko' ? '2차 인증 설정' : 'Setup 2FA')}
                </Button>
              )}
            </div>

            {showSetup && (
              <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start pt-1 max-w-xl animate-in fade-in-50 duration-200">
                <div className="bg-white p-2 rounded-md shrink-0">
                  <img src={qrCode} alt="QR Code" className="w-36 h-36 mx-auto" />
                </div>

                <div className="flex-1 w-full space-y-4">
                  <p className="text-xs font-semibold text-foreground">
                    {language === 'ko' ? '1. QR 코드 스캔' : '1. Scan QR Code'}
                  </p>

                  <form onSubmit={handleVerify2FA} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="otp" className="text-xs font-semibold text-foreground">
                        {language === 'ko' ? `2. ${t('login.otpCode')} 입력` : `2. Enter ${t('login.otpCode')}`}
                      </Label>
                      <Input
                        id="otp"
                        value={otp}
                        onChange={e => setOtp(e.target.value)}
                        placeholder="000000"
                        required
                        maxLength={6}
                        className="h-10 text-center font-mono text-lg font-bold tracking-[0.4em] bg-background"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button type="button" variant="outline" onClick={() => setShowSetup(false)}>
                        {t('common.cancel')}
                      </Button>
                      <Button type="submit">
                        <ShieldCheck className="h-4 w-4 mr-1.5" />
                        {t('settings.verifyBtn')}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. 화면 및 시스템 설정 */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 pb-2.5 border-b border-border">
          <MonitorPlay className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">{t('settings.secScreen')}</h3>
        </div>

        <div className="divide-y divide-border/60">
          {/* 화면 배율 설정 */}
          <div className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
              <ZoomIn className="h-4 w-4 text-muted-foreground" /> {t('settings.uiScale')}
            </h4>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {[90, 100, 110, 120, 130].map((s) => (
                <Button
                  key={s}
                  variant={scale === s ? 'default' : 'outline'}
                  onClick={() => handleScaleChange(s)}
                  className="min-w-16"
                >
                  {s}%
                </Button>
              ))}
            </div>
          </div>

          {/* 언어 설정 */}
          <div className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
              <Globe className="h-4 w-4 text-muted-foreground" /> {t('settings.language')}
            </h4>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant={language === 'en' ? 'default' : 'outline'}
                onClick={() => { setLanguage('en'); toast.success(t('settings.languageSuccess')); }}
                className="min-w-24"
              >
                English
              </Button>
              <Button
                variant={language === 'ko' ? 'default' : 'outline'}
                onClick={() => { setLanguage('ko'); toast.success(t('settings.languageSuccess')); }}
                className="min-w-24"
              >
                한국어
              </Button>
            </div>
          </div>

          {/* Download Resolution Settings */}
          <div className="py-5 space-y-4">
            <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
              <MonitorPlay className="h-4 w-4 text-muted-foreground" /> {t('settings.downloadResolution')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
              <div className="space-y-2">
                <Label htmlFor="liveResolution">{t('settings.liveResolution')}</Label>
                <select
                  id="liveResolution"
                  value={liveResolution}
                  onChange={(e) => { setLiveResolution(e.target.value); handleSaveUserSettings({ live_resolution: e.target.value }); }}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="1080p">1080p ({language === 'ko' ? '기본' : 'Default'})</option>
                  <option value="720p">720p</option>
                  <option value="360p">360p</option>
                  <option value="144p">144p</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vodResolution">{t('settings.vodResolution')}</Label>
                <select
                  id="vodResolution"
                  value={vodResolution}
                  onChange={(e) => { setVodResolution(e.target.value); handleSaveUserSettings({ vod_resolution: e.target.value }); }}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="ask">{t('settings.vodAskEveryTime')}</option>
                  <option value="1080p">1080p ({language === 'ko' ? '기본' : 'Default'})</option>
                  <option value="720p">720p</option>
                  <option value="360p">360p</option>
                  <option value="144p">144p</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 외부 서비스 연동 */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 pb-2.5 border-b border-border">
          <Bell className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">{t('settings.secExternal')}</h3>
        </div>

        <div className="divide-y divide-border/60">
          {/* Chzzk Cookies */}
          <div className="py-5 space-y-4">
            <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
              <Cookie className="h-4 w-4 text-muted-foreground" />
              {t('settings.chzzkCookies')}
            </h4>

            {!showCookieInputs ? (
              <div className="space-y-3 max-w-lg">
                {user.has_cookies ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-semibold text-sm">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{language === 'ko' ? '치지직 계정이 연동되었습니다.' : 'Chzzk account is connected.'}</span>
                    </div>
                    {chzzkNickname && (
                      <p className="text-xs text-muted-foreground pl-6 font-medium">
                        {language === 'ko' ? `치지직 닉네임: ${chzzkNickname}` : `Chzzk Nickname: ${chzzkNickname}`}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.chzzkNotConnected')}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCookieInputs(true)}
                    className="px-4"
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    {user.has_cookies ? t('settings.editCookieValues') : t('settings.enterCookieValues')}
                  </Button>
                  {user.has_cookies && (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-red-500 border-red-500/50 hover:bg-red-500/10 hover:text-red-600 px-4"
                      onClick={handleClearCookies}
                      disabled={cookieSaveLoading}
                    >
                      {t('settings.clearCookies')}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="nidAut">NID_AUT</Label>
                  <Input
                    id="nidAut"
                    value={nidAut}
                    onChange={e => { setNidAut(e.target.value); setCookieVerified(null); }}
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
                    placeholder={t('settings.cookiesPlaceholder')}
                    className="font-mono text-sm"
                  />
                </div>

                {cookieVerified !== null && (
                  <div className={`flex items-center gap-2 text-sm font-medium ${cookieVerified.valid
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-500'
                    }`}>
                    {cookieVerified.valid ? (
                      <>
                        <UserCheck className="h-4 w-4 shrink-0" />
                        {t('settings.cookiesVerifiedSuccess', { name: cookieVerified.nickname || '' })}
                      </>
                    ) : (
                      <>
                        <ShieldQuestion className="h-4 w-4 shrink-0" />
                        {t('settings.cookiesVerifiedFailed')}
                      </>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" onClick={handleSaveCookiesSubmit} disabled={cookieSaveLoading}>
                    {cookieSaveLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t('settings.save')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowCookieInputs(false)}>
                    {t('settings.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* YouTube Auto Upload */}
          <div className="py-5 space-y-5">
            <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
              <MonitorPlay className="h-4 w-4 text-muted-foreground" /> {t('settings.youtubeAutoUpload')}
            </h4>

            <div className="space-y-4 max-w-2xl">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="youtubeAutoUpload" className="text-sm font-medium cursor-pointer">{t('settings.autoUploadEnable')}</Label>
                <Switch
                  id="youtubeAutoUpload"
                  checked={youtubeAutoUpload}
                  onCheckedChange={(val) => { setYoutubeAutoUpload(val); handleSaveUserSettings({ youtube_auto_upload: val }); }}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="deleteAfterUpload" className="text-sm font-medium cursor-pointer">{t('settings.deleteAfterUpload')}</Label>
                <Switch
                  id="deleteAfterUpload"
                  checked={deleteAfterUpload}
                  onCheckedChange={(val) => { setDeleteAfterUpload(val); handleSaveUserSettings({ delete_after_upload: val }); }}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <Label className="text-sm font-medium">{t('settings.youtubePrivacy')}</Label>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {([
                    { value: 'public', label: t('settings.privacyPublic') },
                    { value: 'unlisted', label: t('settings.privacyUnlisted') },
                    { value: 'private', label: t('settings.privacyPrivate') },
                  ] as const).map((opt) => (
                    <Button
                      key={opt.value}
                      type="button"
                      variant={youtubePrivacyStatus === opt.value ? 'default' : 'outline'}
                      onClick={() => {
                        setYoutubePrivacyStatus(opt.value);
                        handleSaveUserSettings({ youtube_privacy_status: opt.value });
                      }}
                      className="px-4"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {!showYoutubeInputs ? (
              <div className="space-y-3 max-w-lg">
                {youtubeConnected ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-semibold text-sm">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{language === 'ko' ? '유튜브 채널이 연동되었습니다.' : 'YouTube channel is connected.'}</span>
                    </div>
                    {youtubeChannelTitle && (
                      <p className="text-xs text-muted-foreground pl-6 font-medium">
                        {language === 'ko' ? `유튜브 닉네임: ${youtubeChannelTitle}` : `YouTube Nickname: ${youtubeChannelTitle}`}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.youtubeNotConnected')}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setShowYoutubeInputs(true)} className="px-4">
                    <KeyRound className="mr-2 h-4 w-4" />
                    {youtubeConnected ? t('settings.editChannelBtn') : t('settings.connectChannelBtn')}
                  </Button>
                  {youtubeConnected && (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-red-500 border-red-500/50 hover:bg-red-500/10 hover:text-red-600 px-4"
                      onClick={handleDisconnectYoutube}
                    >
                      {t('settings.disconnectChannel')}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="youtubeClientId">{t('settings.clientId')}</Label>
                  <Input
                    id="youtubeClientId"
                    value={youtubeClientId}
                    onChange={e => setYoutubeClientId(e.target.value)}
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
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" onClick={handleSaveYoutubeSettingsSubmit}>
                    {t('settings.save')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowYoutubeInputs(false)}>
                    {t('settings.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Discord Webhook */}
          <div className="py-5 space-y-4">
            <h4 className="text-base font-medium flex items-center gap-2 text-foreground">
              <Bell className="h-4 w-4 text-muted-foreground" /> {t('settings.discordWebhook')}
            </h4>

            <div className="space-y-4 max-w-2xl">
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={discordWebhookUseEmbed ? 'default' : 'outline'}
                    onClick={() => { setDiscordWebhookUseEmbed(true); handleSaveUserSettings({ discord_webhook_use_embed: true }); }}
                    className="px-4"
                  >
                    {language === 'ko' ? '카드 형태 (Embed)' : 'Rich Card (Embed)'}
                  </Button>
                  <Button
                    type="button"
                    variant={!discordWebhookUseEmbed ? 'default' : 'outline'}
                    onClick={() => { setDiscordWebhookUseEmbed(false); handleSaveUserSettings({ discord_webhook_use_embed: false }); }}
                    className="px-4"
                  >
                    {language === 'ko' ? '단순 텍스트 형태' : 'Simple Text'}
                  </Button>
                </div>
              </div>

              {/* 디스코드 알림 미리보기 */}
              <div className="space-y-2 max-w-lg pt-1">
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">{language === 'ko' ? '미리보기' : 'Preview'}</p>
                <div className="p-3.5 bg-[#313338] text-[#dbdee1] rounded-md font-sans text-sm">
                  <div className="flex gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#5865F2] flex-shrink-0 flex items-center justify-center text-white font-bold text-base">
                      Z
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-white text-[15px]">ZKZZK Bot</span>
                        <span className="text-[10px] bg-[#5865F2] text-white px-1 py-[1px] rounded leading-none flex items-center justify-center uppercase font-bold">Bot</span>
                        <span className="text-xs text-[#949ba4] font-medium ml-1">{language === 'ko' ? '오늘 오후 3:00' : 'Today at 3:00 PM'}</span>
                      </div>
                      {discordWebhookUseEmbed ? (
                        <div className="border-l-4 border-blue-500 pl-3 py-1 mt-1.5">
                          <p className="font-bold text-white text-sm mb-1">🎥 {language === 'ko' ? '업로드 완료' : 'Upload Complete'}</p>
                          <div className="text-[13px] space-y-0.5">
                            <p>{language === 'ko' ? 'XXX님의 영상이 성공적으로 업로드되었습니다.' : "XXX's video has been successfully uploaded."}</p>
                            <p className="pt-1"><strong>{language === 'ko' ? '제목' : 'Title'}:</strong> {language === 'ko' ? '테스트 영상' : 'Test Video'}</p>
                            <p><strong>URL:</strong> <span className="text-[#00a8fc] cursor-pointer hover:underline">https://youtu.be/test</span></p>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap text-[14px] leading-relaxed mt-0.5">
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
            </div>
          </div>
        </div>
      </section>

      {/* 4. 관리자 메뉴 */}
      {user.is_admin && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">{t('settings.userManagement')}</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-amber-500/20 text-amber-700 dark:text-amber-300">{language === 'ko' ? '관리자 전용' : 'Admin Only'}</span>
            </div>
            {!showAddUserForm && (
              <Button
                type="button"
                onClick={() => setShowAddUserForm(true)}
                className="shrink-0 px-4"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {t('settings.addUser')}
              </Button>
            )}
          </div>

          {/* Add User Form */}
          {showAddUserForm && (
            <div className="pb-5 border-b border-border/60 space-y-4 max-w-2xl animate-in fade-in-50 duration-200">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm flex items-center gap-2 text-foreground">
                  <UserCheck className="h-4 w-4 text-primary" />
                  {t('settings.addUser')}
                </h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAddUserForm(false)}
                  className="text-muted-foreground hover:text-foreground h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="newUsername" className="text-xs font-medium">{t('login.username')}</Label>
                    <Input
                      id="newUsername"
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder={t('login.username')}
                      required
                      className="h-9 bg-background"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="newUserPass" className="text-xs font-medium">{t('login.password')}</Label>
                    <Input
                      id="newUserPass"
                      type="password"
                      value={newUserPass}
                      onChange={e => setNewUserPass(e.target.value)}
                      placeholder={t('settings.newPasswordPlaceholder')}
                      required
                      className="h-9 bg-background"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="newUserIsAdmin"
                      checked={newUserIsAdmin}
                      onCheckedChange={setNewUserIsAdmin}
                    />
                    <Label htmlFor="newUserIsAdmin" className="text-sm cursor-pointer select-none font-medium">{t('layout.admin')}</Label>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setShowAddUserForm(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button type="submit" disabled={userLoading}>
                      {userLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
                      {t('settings.addUserBtn')}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* User List */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium pb-2 border-b border-border/60 flex justify-between items-center">
              <span>{language === 'ko' ? `등록된 사용자 (${users.length}명)` : `Registered Users (${users.length})`}</span>
            </div>
            {users.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground text-sm">{t('common.loading')}</p>
            ) : (
              <div className="divide-y divide-border/60">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-3 px-2 -mx-2 rounded-md hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                        {u.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{u.username}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {u.is_admin && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-amber-500/20 text-amber-700 dark:text-amber-300">{t('layout.admin')}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {u.created_at ? new Date(u.created_at).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US') : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                    {u.id !== user.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                        onClick={() => handleDeleteUser(u.id, u.username)}
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    {u.id === user.id && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-muted text-muted-foreground">{language === 'ko' ? '나' : 'Me'}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <Dialog open={!!confirmConfig} onOpenChange={(open) => { if (!open) setConfirmConfig(null); }}>
        <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
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
