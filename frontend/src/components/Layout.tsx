import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Video, Download, Settings, LogOut, Sun, Moon } from 'lucide-react';
import { Button } from './ui/button';
import api from '../api';
import { useEffect, useState } from 'react';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: '라이브' },
  { path: '/recordings', icon: Video, label: '녹화본' },
  { path: '/vod', icon: Download, label: 'VOD 다운로더' },
  { path: '/settings', icon: Settings, label: '설정' },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<{ username: string; is_admin: boolean } | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then(res => setUser(res.data)).catch(() => navigate('/login'));
    setIsDark(document.documentElement.classList.contains('dark'));
  }, [navigate]);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const handleLogout = async () => {
    await api.post('/auth/logout');
    navigate('/login');
  };

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-background text-foreground transition-colors duration-200">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card px-4 py-6 flex flex-col justify-between">
        <div className="flex flex-col flex-1">
          <div className="flex items-center justify-between mb-10 px-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">ZKZZK</h1>
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground">
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
              return (
                <Link key={item.path} to={item.path}>
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    className="w-full justify-start gap-3"
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="border-t border-border pt-4 mt-6">
          <div className="px-2 mb-4 text-sm text-muted-foreground">
            접속중: <span className="text-foreground font-medium">{user.username}</span> {user.is_admin && '(관리자)'}
          </div>
          <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 gap-3" onClick={handleLogout}>
            <LogOut className="h-5 w-5" />
            로그아웃
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background p-8">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
