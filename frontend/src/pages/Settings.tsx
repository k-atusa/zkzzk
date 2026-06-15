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
  Eye, EyeOff, ShieldQuestion, ZoomIn
} from 'lucide-react';
import api from '@/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export const Settings = () => {
  const [user, setUser] = useState<any>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    description: string | React.ReactNode;
    onConfirm: () => void;
    isDestructive?: boolean;
  } | null>(null);

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
      if (res.data.has_cookies) {
        fetchCookies();
      }
    } catch (e) {
      toast.error('설정을 불러오는데 실패했습니다.');
    }
  };

  const fetchCookies = async () => {
    try {
      const res = await api.get('/auth/cookies');
      if (res.data.nid_aut) setNidAut(res.data.nid_aut);
      if (res.data.nid_ses) setNidSes(res.data.nid_ses);
    } catch (e) {}
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/auth/users');
      setUsers(res.data);
    } catch (e) {}
  };

  useEffect(() => {
    fetchMe();
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
      await api.post('/auth/cookies', { nid_aut: nidAut.trim() || null, nid_ses: nidSes.trim() || null });
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
          await api.post('/auth/cookies', { nid_aut: null, nid_ses: null });
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

      {/* Chzzk Cookie Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5" />
            치지직 계정 연동
            {user.has_cookies && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">
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
              <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${
                cookieVerified.valid
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
                <Button type="button" variant="destructive" onClick={handleClearCookies} disabled={cookieSaveLoading}>
                  쿠키 초기화
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Management Card (Admin only) */}
      {user.is_admin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> 사용자 관리
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">관리자 전용</span>
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
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">관리자</span>
                          )}
                          {(u.nid_aut && u.nid_ses) && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 border border-green-500/20 flex items-center gap-0.5">
                              <Cookie className="h-2.5 w-2.5" /> 쿠키 설정됨
                            </span>
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
