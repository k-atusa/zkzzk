import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import api from '@/api';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [isSetup, setIsSetup] = useState(false);
  const [requireOtp, setRequireOtp] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/auth/status').then(res => {
      if (!res.data.initialized) setIsSetup(true);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isSetup) {
        await api.post('/auth/setup', { username, password });
        toast.success('관리자 계정이 생성되었습니다.');
        navigate('/');
      } else {
        const res = await api.post('/auth/login', { username, password, otp });
        if (res.data.requireOtp) {
          setRequireOtp(true);
          toast.info('OTP 코드를 입력해주세요.');
        } else {
          toast.success('로그인 성공');
          navigate('/');
        }
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || '오류가 발생했습니다.');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight font-google-sans">ZKZZK</CardTitle>
          <CardDescription>
            {isSetup ? '최초 관리자 계정을 생성합니다.' : (requireOtp ? '2차 인증 OTP를 입력하세요.' : '계정에 로그인하세요.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!requireOtp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">아이디</Label>
                  <Input id="username" value={username} onChange={e => setUsername(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">비밀번호</Label>
                  <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                </div>
              </>
            )}
            {requireOtp && (
              <div className="space-y-2">
                <Label htmlFor="otp">OTP 코드</Label>
                <Input id="otp" type="text" value={otp} onChange={e => setOtp(e.target.value)} required autoFocus />
              </div>
            )}
            <Button type="submit" className="w-full">
              {isSetup ? '계정 생성' : (requireOtp ? '인증' : '로그인')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
