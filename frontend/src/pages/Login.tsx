import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import api from '@/api';
import { useLanguage } from '@/lib/i18n';

export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [isSetup, setIsSetup] = useState(false);
  const [requireOtp, setRequireOtp] = useState(false);
  const navigate = useNavigate();
  const { t } = useLanguage();

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
        toast.success(t('login.accountCreated'));
        navigate('/');
      } else {
        const res = await api.post('/auth/login', { username, password, otp });
        if (res.data.requireOtp) {
          setRequireOtp(true);
          toast.info(t('login.enterOtp'));
        } else {
          toast.success(t('login.loginSuccess'));
          navigate('/');
        }
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('login.errorOccurred'));
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight font-google-sans">{t('login.title')}</CardTitle>
          <CardDescription>
            {isSetup ? t('login.setupSubtitle') : (requireOtp ? t('login.otpSubtitle') : t('login.loginSubtitle'))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!requireOtp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">{t('login.username')}</Label>
                  <Input id="username" value={username} onChange={e => setUsername(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t('login.password')}</Label>
                  <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                </div>
              </>
            )}
            {requireOtp && (
              <div className="space-y-2">
                <Label htmlFor="otp">{t('login.otpCode')}</Label>
                <Input id="otp" type="text" value={otp} onChange={e => setOtp(e.target.value)} required autoFocus />
              </div>
            )}
            <Button type="submit" className="w-full">
              {isSetup ? t('login.createAccount') : (requireOtp ? t('login.verify') : t('login.loginBtn'))}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
