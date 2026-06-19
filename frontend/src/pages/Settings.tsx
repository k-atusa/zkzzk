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
  Eye, EyeOff, ShieldQuestion, ZoomIn, Bell, Save, MonitorPlay
} from 'lucide-react';
import api from '@/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export const Settings = () => {
  const [user, setUser] = useState<any>(null);

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
  const [webhookLoading, setWebhookLoading] = useState(false);

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
    toast.success(`화면 배율이 ${newScale}%로 설정되었습니다.`);
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
      toast.error('설정을 불러오는데 실패했습니다.');
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
        ? `YouTube 인증이 완료되었습니다. (채널: ${channelName})`
        : 'YouTube 인증이 완료되었습니다.'
      );
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (searchParams.get('youtube') === 'error') {
      toast.error('YouTube 인증 중 오류가 발생했습니다.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // 2FA handlers
  const handleSetup2FA = async () => {
    try {
      const res = await api.post('/auth/2fa/setup');
      setQrCode(res.data.qrcode_data_url);
      setShowSetup(true);
    } catch (error: any) {
      toast.error(error.response?.data?.message || '2FA 설정 요청 실패');
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/2fa/verify', { otp });
      toast.success('2차 인증이 활성화되었습니다.');
      setShowSetup(false);
      setOtp('');
      fetchMe();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '인증 실패');
    }
  };

  const handleDisable2FA = () => {
    setConfirmConfig({
      title: '2차 인증 비활성화',
      description: '2차 인증을 비활성화하시겠습니까?',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.post('/auth/2fa/disable');
          toast.success('2차 인증이 비활성화되었습니다.');
          fetchMe();
        } catch (error: any) {
          toast.error(error.response?.data?.message || '비활성화 실패');
        }
      }
    });
  };

  // Password Change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('새 비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    setPwLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('비밀번호가 변경되었습니다.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast.error(error.response?.data?.message || '비밀번호 변경 실패');
    } finally {
      setPwLoading(false);
    }
  };

  // Cookie handlers
  const handleVerifyCookies = async () => {
    if (!nidAut.trim() || !nidSes.trim()) {
      toast.error('NID_AUT와 NID_SES 값을 모두 입력해주세요.');
      return;
    }
    setCookieLoading(true);
    setCookieVerified(null);
    try {
      const res = await api.post('/auth/verify-cookies', { nid_aut: nidAut.trim(), nid_ses: nidSes.trim() });
      setCookieVerified(res.data);
      if (res.data.valid) {
        toast.success(`인증 성공: ${res.data.nickname}`);
      } else {
        toast.error('유효하지 않은 쿠키입니다. 다시 확인해주세요.');
      }
    } catch (error: any) {
      toast.error('쿠키 인증 중 오류가 발생했습니다.');
      setCookieVerified({ valid: false });
    } finally {
      setCookieLoading(false);
    }
  };

  const handleSaveCookies = async () => {
    setCookieSaveLoading(true);
    try {
      await api.post('/auth/user-settings', { nid_aut: nidAut.trim() || null, nid_ses: nidSes.trim() || null });
      toast.success('쿠키가 저장되었습니다.');
      fetchMe();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '쿠키 저장 실패');
    } finally {
      setCookieSaveLoading(false);
    }
  };

  const handleClearCookies = () => {
    setConfirmConfig({
      title: '쿠키 초기화',
      description: '쿠키를 초기화하시겠습니까?',
      isDestructive: true,
      onConfirm: async () => {
        setCookieSaveLoading(true);
        try {
          await api.post('/auth/user-settings', { nid_aut: null, nid_ses: null });
          setNidAut('');
          setNidSes('');
          setCookieVerified(null);
          toast.success('쿠키가 초기화되었습니다.');
          fetchMe();
        } catch (error: any) {
          toast.error('쿠키 초기화 실패');
        } finally {
          setCookieSaveLoading(false);
        }
      }
    });
  };

  const handleSaveUserSettings = async () => {
    setWebhookLoading(true);
    try {
      await api.post('/auth/user-settings', {
        discord_webhook_url: discordWebhookUrl.trim(),
        discord_webhook_use_embed: discordWebhookUseEmbed,
        youtube_client_id: youtubeClientId.trim(),
        youtube_client_secret: youtubeClientSecret.trim(),
        youtube_auto_upload: youtubeAutoUpload,
        delete_after_upload: deleteAfterUpload,
        live_resolution: liveResolution,
        vod_resolution: vodResolution
      });
      toast.success('설정이 저장되었습니다.');
      fetchUserSettings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '저장 실패');
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleYouTubeAuth = async () => {
    try {
      const res = await api.get('/youtube/auth-url');
      if (res.data.url) {
        window.location.href = res.data.url;
      }
    } catch (e: any) {
      toast.error('인증 URL을 가져오는데 실패했습니다.');
    }
  };

  // User Management
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newUserPass.trim()) return;
    setUserLoading(true);
    try {
      await api.post('/auth/users', { username: newUsername.trim(), password: newUserPass, is_admin: newUserIsAdmin });
      toast.success(`사용자 '${newUsername}'가 추가되었습니다.`);
      setNewUsername('');
      setNewUserPass('');
      setNewUserIsAdmin(false);
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '사용자 추가 실패');
    } finally {
      setUserLoading(false);
    }
  };

  const handleDeleteUser = (userId: string, username: string) => {
    setConfirmConfig({
      title: '사용자 삭제',
      description: `'${username}' 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.delete(`/auth/users/${userId}`);
          toast.success(`'${username}' 사용자가 삭제되었습니다.`);
          fetchUsers();
        } catch (error: any) {
          toast.error(error.response?.data?.message || '사용자 삭제 실패');
        }
      }
    });
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">설정</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Password Change Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Lock className="mr-2 h-5 w-5" /> 비밀번호 변경
            </CardTitle>
            <CardDescription>현재 비밀번호를 입력한 후 새 비밀번호로 변경하세요.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">현재 비밀번호</Label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="현재 비밀번호"
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
                <Label htmlFor="newPassword">새 비밀번호</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="새 비밀번호 (6자 이상)"
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
                <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="새 비밀번호 재입력"
                  required
                />
              </div>
              <Button type="submit" disabled={pwLoading}>
                {pwLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                비밀번호 변경
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 2FA Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <KeyRound className="mr-2 h-5 w-5" /> 2차 인증 (OTP)
            </CardTitle>
            <CardDescription>보안을 위해 2차 인증을 설정하세요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-border rounded-lg">
              <div className="flex items-center space-x-4">
                {user.totp_enabled ? <ShieldCheck className="h-6 w-6 text-green-500" /> : <ShieldAlert className="h-6 w-6 text-yellow-500" />}
                <div>
                  <p className="font-medium">{user.totp_enabled ? '2차 인증 사용 중' : '2차 인증 미사용'}</p>
                  <p className="text-sm text-muted-foreground">
                    {user.totp_enabled ? '계정이 안전하게 보호되고 있습니다.' : '인증기 앱을 사용하여 OTP를 등록하세요.'}
                  </p>
                </div>
              </div>
              <Switch
                checked={user.totp_enabled}
                onCheckedChange={(checked) => checked ? handleSetup2FA() : handleDisable2FA()}
              />
            </div>

            {showSetup && (
              <div className="mt-6 p-6 border border-border rounded-lg bg-muted/40">
                <h3 className="text-lg font-medium mb-4">OTP 설정</h3>
                <div className="flex flex-col xl:flex-row gap-6 items-start">
                  <div className="bg-white p-2 rounded-lg shrink-0 mx-auto xl:mx-0">
                    <img src={qrCode} alt="QR Code" className="w-40 h-40" />
                  </div>
                  <div className="flex-1 w-full">
                    <p className="text-xs text-muted-foreground mb-4">
                      Google Authenticator 앱 등으로 QR 코드를 스캔한 후 코드를 입력하세요.
                    </p>
                    <form onSubmit={handleVerify2FA} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="otp">인증 코드</Label>
                        <Input
                          id="otp"
                          value={otp}
                          onChange={e => setOtp(e.target.value)}
                          placeholder="000000"
                          required
                          maxLength={6}
                        />
                      </div>
                      <div className="flex space-x-2">
                        <Button type="submit">확인</Button>
                        <Button type="button" variant="outline" onClick={() => setShowSetup(false)}>취소</Button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 화면 배율 설정 Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ZoomIn className="h-5 w-5" /> 화면 배율 설정
          </CardTitle>
          <CardDescription>
            전체적인 UI 글꼴 및 크기 배율을 조절하여 가장 편안한 크기로 화면을 사용하세요.
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
            <MonitorPlay className="h-5 w-5" /> 다운로드 화질 설정
          </CardTitle>
          <CardDescription>라이브 영상과 다시보기 영상의 다운로드 화질을 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl border border-border p-4 rounded-lg bg-muted/10">
            <div className="space-y-2">
              <Label htmlFor="liveResolution">라이브 영상 화질</Label>
              <select
                id="liveResolution"
                value={liveResolution}
                onChange={(e) => setLiveResolution(e.target.value)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="1080p">1080p (기본)</option>
                <option value="720p">720p</option>
                <option value="360p">360p</option>
                <option value="144p">144p</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">선택한 화질이 없을 경우 가능한 최고/최저 화질로 자동 폴백됩니다.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vodResolution">다시보기(VOD) 화질</Label>
              <select
                id="vodResolution"
                value={vodResolution}
                onChange={(e) => setVodResolution(e.target.value)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="1080p">1080p (기본)</option>
                <option value="720p">720p</option>
                <option value="360p">360p</option>
                <option value="144p">144p</option>
              </select>
            </div>
          </div>
          <Button onClick={handleSaveUserSettings} disabled={webhookLoading}>
            {webhookLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            화질 설정 저장
          </Button>
        </CardContent>
      </Card>

      {/* Chzzk Cookie Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5" />
            치지직 계정 연동
            {user.has_cookies && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">
                <CheckCircle2 className="h-3 w-3" /> 연동됨
              </span>
            )}
          </CardTitle>
          <CardDescription>
            치지직 NID_AUT, NID_SES 쿠키를 입력하면 자동 녹화에 사용됩니다. 브라우저 개발자 도구(F12) → Application → Cookies에서 확인할 수 있습니다.
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
                placeholder="NID_AUT 쿠키 값"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nidSes">NID_SES</Label>
              <Input
                id="nidSes"
                value={nidSes}
                onChange={e => { setNidSes(e.target.value); setCookieVerified(null); }}
                placeholder="NID_SES 쿠키 값"
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
                    인증된 사용자: {cookieVerified.nickname}
                  </>
                ) : (
                  <>
                    <ShieldQuestion className="h-4 w-4" />
                    유효하지 않은 쿠키입니다.
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleVerifyCookies} disabled={cookieLoading}>
                {cookieLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                쿠키 인증 확인
              </Button>
              <Button type="button" onClick={handleSaveCookies} disabled={cookieSaveLoading}>
                {cookieSaveLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                저장
              </Button>
              {user.has_cookies && (
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-500 border-red-500/50 hover:bg-red-500/10 hover:text-red-600"
                  onClick={handleClearCookies}
                  disabled={cookieSaveLoading}
                >
                  쿠키 초기화
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> 외부 서비스 연동 설정
          </CardTitle>
          <CardDescription>개인 디스코드 Webhook 및 YouTube 자동 업로드 연동을 관리합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="discordWebhookUrl">Discord Webhook URL</Label>
              <Input
                id="discordWebhookUrl"
                value={discordWebhookUrl}
                onChange={e => setDiscordWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
              />
              <p className="text-xs text-muted-foreground">
                디스코드 웹훅을 등록하면 녹화 시작/종료 시 알림을 받을 수 있습니다.
              </p>
            </div>
            <div className="space-y-2">
              <Label>알림 메시지 형태</Label>
              <div className="flex gap-4">
                <label className={`flex items-center justify-center px-4 py-2 border rounded-md cursor-pointer transition-colors ${discordWebhookUseEmbed ? 'bg-primary/10 border-primary text-primary' : 'border-input hover:bg-accent'}`}>
                  <input type="radio" className="hidden" checked={discordWebhookUseEmbed} onChange={() => setDiscordWebhookUseEmbed(true)} />
                  <span className="text-sm font-medium">카드 형태 (Embed)</span>
                </label>
                <label className={`flex items-center justify-center px-4 py-2 border rounded-md cursor-pointer transition-colors ${!discordWebhookUseEmbed ? 'bg-primary/10 border-primary text-primary' : 'border-input hover:bg-accent'}`}>
                  <input type="radio" className="hidden" checked={!discordWebhookUseEmbed} onChange={() => setDiscordWebhookUseEmbed(false)} />
                  <span className="text-sm font-medium">단순 텍스트 형태</span>
                </label>
              </div>
            </div>

            {/* 디스코드 알림 미리보기 */}
            <div className="mt-4 p-4 bg-[#313338] text-[#dbdee1] rounded-md font-sans max-w-md shadow-inner text-sm border border-[#1e1f22]">
              <p className="text-xs text-[#949ba4] mb-3 uppercase font-bold tracking-wider">미리보기</p>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-[#5865F2] flex-shrink-0 flex items-center justify-center text-white font-bold text-lg">
                  Z
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-white text-[15px]">ZKZZK Bot</span>
                    <span className="text-[10px] bg-[#5865F2] text-white px-1 py-[1px] rounded leading-none flex items-center justify-center uppercase font-bold">Bot</span>
                    <span className="text-xs text-[#949ba4] font-medium ml-1">오늘 오후 3:00</span>
                  </div>
                  {discordWebhookUseEmbed ? (
                    <div className="bg-[#2b2d31] border-l-4 border-blue-500 rounded p-3 mt-1.5 inline-block min-w-[250px]">
                      <p className="font-bold text-white text-base mb-1.5">🎥 업로드 완료</p>
                      <div className="text-[13px] space-y-1">
                        <p><strong>스트리머:</strong> XXX</p>
                        <p><strong>제목:</strong> 테스트 영상</p>
                        <p><strong>URL:</strong> <span className="text-[#00a8fc] cursor-pointer hover:underline">https://youtu.be/test</span></p>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-[15px] leading-relaxed mt-0.5">
                      <span className="font-bold">🎥 업로드 완료</span>{'\n'}
                      스트리머: XXX{'\n'}
                      제목: 테스트 영상{'\n'}
                      URL: <span className="text-[#00a8fc] cursor-pointer hover:underline">https://youtu.be/test</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
          <div className="space-y-2 mt-4 pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between mb-2">
              <Label htmlFor="youtubeClientId">YouTube Client ID</Label>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="youtubeAutoUpload" className="text-sm cursor-pointer text-muted-foreground font-normal">
                    자동 업로드 활성화
                  </Label>
                  <Switch
                    id="youtubeAutoUpload"
                    checked={youtubeAutoUpload}
                    onCheckedChange={setYoutubeAutoUpload}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="deleteAfterUpload" className="text-sm cursor-pointer text-muted-foreground font-normal">
                    업로드 후 자동 삭제
                  </Label>
                  <Switch
                    id="deleteAfterUpload"
                    checked={deleteAfterUpload}
                    onCheckedChange={setDeleteAfterUpload}
                  />
                </div>
              </div>
            </div>
            <Input
              id="youtubeClientId"
              value={youtubeClientId}
              onChange={e => setYoutubeClientId(e.target.value)}
              placeholder="Google Cloud Console에서 발급받은 Client ID"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="youtubeClientSecret">YouTube Client Secret</Label>
            <div className="relative">
              <Input
                id="youtubeClientSecret"
                value={youtubeClientSecret}
                onChange={e => setYoutubeClientSecret(e.target.value)}
                placeholder="Google Cloud Console에서 발급받은 Client Secret"
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
                <p className="font-semibold mb-1 text-foreground">💡 자동 업로드 설정 방법:</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li><a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">Google Cloud Console</a>에서 프로젝트를 생성합니다.</li>
                  <li><strong>YouTube Data API v3</strong>를 활성화합니다.</li>
                  <li>OAuth 동의 화면을 설정하고, <strong>웹 애플리케이션</strong> 유형의 사용자 인증 정보를 만듭니다.</li>
                  <li>승인된 리디렉션 URI에 <code className="select-all font-mono bg-muted px-1.5 py-0.5 rounded text-xs font-semibold text-primary border border-primary/10">{getCallbackUrl()}</code> 를 추가합니다.</li>
                  <li>발급받은 Client ID와 Client Secret을 위에 입력하고 <strong>저장</strong>을 누릅니다.</li>
                  <li><strong>YouTube 인증하기</strong> 버튼을 눌러 계정을 연동합니다.</li>
                </ol>
              </div>
              <div className="border-t border-border/60 pt-2.5">
                <p className="font-semibold mb-1 text-amber-600 dark:text-amber-500">⚠️ '403 access_denied' (인증 절차 미완료) 오류 해결 방법:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Google Cloud Console의 <strong>Google 인증 플랫폼 &gt; 대상 &gt; OAuth 사용자 한도 &gt; 테스트 사용자</strong> 화면으로 이동합니다.</li>
                  <li>해당 화면에서 <strong>ADD USERS</strong>를 클릭하고, 인증하려는 Google 계정(이메일 주소)을 등록한 뒤 다시 시도해 주세요.</li>
                  <li>발급받은 <strong>API Key(OAuth 클라이언트)의 소유자 계정</strong>과 <strong>유튜브 인증을 진행하는 로그인 계정</strong>이 일치하는지 확인해 주세요. (서로 다른 계정일 경우 테스트 사용자 목록에 추가해야 합니다.)</li>
                  <li>또는 앱 게시 상태가 '테스트 중'이기 때문이므로 <strong>앱 게시 (Publish App)</strong>를 눌러 프로덕션으로 전환하셔도 무방합니다. (보안 경고 발생 시 '고급 &gt; 이동' 클릭)</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSaveUserSettings} disabled={webhookLoading}>
              {webhookLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              저장
            </Button>
            {youtubeClientId && youtubeClientSecret && (
              <Button variant={youtubeConnected ? "secondary" : "default"} onClick={handleYouTubeAuth}>
                {youtubeConnected ? 'YouTube 재인증' : 'YouTube 인증하기'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* User Management Card (Admin only) */}
      {user.is_admin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> 사용자 관리
              <span className="text-xs font-normal px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">관리자 전용</span>
            </CardTitle>
            <CardDescription>사용자를 추가하고 관리합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add User Form */}
            <div className="p-4 border border-border rounded-lg bg-muted/20">
              <h4 className="font-medium mb-3 text-sm">새 사용자 추가</h4>
              <form onSubmit={handleCreateUser} className="space-y-3">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1.5 flex-1 min-w-32">
                    <Label htmlFor="newUsername" className="text-xs">사용자명</Label>
                    <Input
                      id="newUsername"
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder="사용자명"
                      required
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-32">
                    <Label htmlFor="newUserPass" className="text-xs">비밀번호</Label>
                    <Input
                      id="newUserPass"
                      type="password"
                      value={newUserPass}
                      onChange={e => setNewUserPass(e.target.value)}
                      placeholder="비밀번호 (6자 이상)"
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
                    <Label htmlFor="newUserIsAdmin" className="text-sm cursor-pointer">관리자</Label>
                  </div>
                  <Button type="submit" disabled={userLoading} className="h-9">
                    {userLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                    추가
                  </Button>
                </div>
              </form>
            </div>

            {/* User List */}
            <div className="space-y-2">
              {users.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground text-sm">사용자 목록을 불러오는 중...</p>
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
                            <span className="text-xs px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">관리자</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : ''}
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
                      <span className="text-xs text-muted-foreground px-2 py-1">나</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
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
              취소
            </Button>
            <Button variant={confirmConfig?.isDestructive ? "destructive" : "default"} onClick={() => {
              confirmConfig?.onConfirm();
              setConfirmConfig(null);
            }}>
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
