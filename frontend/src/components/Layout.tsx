import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Video, Download, Settings, LogOut } from 'lucide-react';
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

  useEffect(() => {
    api.get('/auth/me').then(res => setUser(res.data)).catch(() => navigate('/login'));
  }, [navigate]);

  const handleLogout = async () => {
    await api.post('/auth/logout');
    navigate('/login');
  };

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-50">
      {/* Sidebar */}
      <aside className="w-64 border-r border-neutral-800 bg-neutral-950 px-4 py-6 flex flex-col">
        <div className="flex items-center mb-10 px-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">ZKZZK</h1>
        </div>
        <nav className="flex-1 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant={isActive ? 'secondary' : 'ghost'}
                  className={`w-full justify-start ${isActive ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-900'}`}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-neutral-800 pt-4 mt-6">
          <div className="px-2 mb-4 text-sm text-neutral-400">
            접속중: <span className="text-white font-medium">{user.username}</span> {user.is_admin && '(관리자)'}
          </div>
          <Button variant="ghost" className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-neutral-900" onClick={handleLogout}>
            <LogOut className="mr-3 h-5 w-5" />
            로그아웃
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-neutral-950 p-8">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
