import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert, KeyRound } from 'lucide-react';
import api from '@/api';

export function Settings() {
  const [user, setUser] = useState<any>(null);
  const [qrCode, setQrCode] = useState('');
  const [otp, setOtp] = useState('');
  const [showSetup, setShowSetup] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data);
    } catch (e) {
      toast.error('설정을 불러오는데 실패했습니다.');
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

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
      fetchStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '인증 실패');
    }
  };

  const handleDisable2FA = async () => {
    if (!confirm('2차 인증을 비활성화하시겠습니까?')) return;
    try {
      await api.post('/auth/2fa/disable');
      toast.success('2차 인증이 비활성화되었습니다.');
      fetchStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '비활성화 실패');
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">설정</h2>

      <Card className="bg-neutral-900 border-neutral-800">
        <CardHeader>
          <CardTitle className="flex items-center">
            <KeyRound className="mr-2 h-5 w-5" /> 2차 인증 (OTP)
          </CardTitle>
          <CardDescription className="text-neutral-400">보안을 위해 2차 인증을 설정하세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-neutral-800 rounded-lg">
            <div className="flex items-center space-x-4">
              {user.totp_enabled ? <ShieldCheck className="h-6 w-6 text-green-500" /> : <ShieldAlert className="h-6 w-6 text-yellow-500" />}
              <div>
                <p className="font-medium text-white">{user.totp_enabled ? '2차 인증 사용 중' : '2차 인증 미사용'}</p>
                <p className="text-sm text-neutral-400">
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
            <div className="mt-6 p-6 border border-neutral-800 rounded-lg bg-neutral-950">
              <h3 className="text-lg font-medium text-white mb-4">OTP 설정</h3>
              <div className="flex flex-col md:flex-row gap-8 items-start">
                <div className="bg-white p-2 rounded-lg">
                  <img src={qrCode} alt="QR Code" className="w-48 h-48" />
                </div>
                <div className="flex-1 w-full">
                  <p className="text-sm text-neutral-400 mb-4">
                    Google Authenticator 또는 Authy 앱으로 좌측 QR 코드를 스캔한 후 생성된 6자리 코드를 입력하세요.
                  </p>
                  <form onSubmit={handleVerify2FA} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="otp">인증 코드</Label>
                      <Input
                        id="otp"
                        value={otp}
                        onChange={e => setOtp(e.target.value)}
                        placeholder="000000"
                        className="bg-neutral-900 border-neutral-800"
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
  );
}
