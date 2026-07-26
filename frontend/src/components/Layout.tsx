import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Video, Download, Settings, LogOut, Sun, Moon, Monitor, Menu, X } from 'lucide-react';
import { Button } from './ui/button';
import api from '../api';
import { useEffect, useState } from 'react';
import pkg from '../../package.json';
import { useLanguage } from '../lib/i18n';
import { cn } from '../lib/utils';

const navItems = [
  { path: '/', icon: LayoutDashboard, key: 'layout.live' },
  { path: '/vod', icon: Download, key: 'layout.vod' },
  { path: '/recordings', icon: Video, key: 'layout.recordings' },
  { path: '/settings', icon: Settings, key: 'layout.settings' },
];

export const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<{ username: string; is_admin: boolean; version?: string } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    api.get('/auth/me').then(res => setUser(res.data)).catch(() => navigate('/login'));
    const savedTheme = (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system';
    setTheme(savedTheme);

    const CACHE_KEY = 'zkzzk_latest_version';
    const CACHE_TIME_KEY = 'zkzzk_latest_version_time';
    const cachedVersion = localStorage.getItem(CACHE_KEY);
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
    const cacheDuration = 1000 * 60 * 60 * 6; // 6 hours

    if (cachedVersion && cachedTime && Date.now() - parseInt(cachedTime) < cacheDuration) {
      setLatestVersion(cachedVersion);
    } else {
      fetch('https://api.github.com/repos/k-atusa/zkzzk/releases/latest')
        .then(res => res.json())
        .then(data => {
          if (data && data.tag_name) {
            const remoteVersion = data.tag_name.replace(/^v/, '');
            setLatestVersion(remoteVersion);
            localStorage.setItem(CACHE_KEY, remoteVersion);
            localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
          }
        })
        .catch(() => { });
    }
  }, [navigate]);

  // Close mobile drawer when route changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const cycleTheme = () => {
    let nextTheme: 'light' | 'dark' | 'system';
    if (theme === 'system') {
      nextTheme = 'light';
    } else if (theme === 'light') {
      nextTheme = 'dark';
    } else {
      nextTheme = 'system';
    }

    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);

    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (nextTheme === 'system') {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(systemPrefersDark ? 'dark' : 'light');
    } else {
      root.classList.add(nextTheme);
    }
  };

  const handleLogout = async () => {
    await api.post('/auth/logout');
    navigate('/login');
  };

  if (!user) return null;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background text-foreground transition-colors duration-200 overflow-hidden">
      {/* Mobile Top Navigation Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card z-40 shrink-0 relative">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMobileNavOpen((prev) => !prev);
            }}
            className="p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer relative z-50"
            aria-label="Toggle Navigation Menu"
          >
            {mobileNavOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <h1 className="text-xl font-bold tracking-tight text-foreground font-google-sans">ZKZZK</h1>
        </div>
        <button
          type="button"
          onClick={cycleTheme}
          className="p-2 -mr-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          title={theme === 'system' ? t('layout.systemTheme') : theme === 'light' ? t('layout.lightMode') : t('layout.darkMode')}
        >
          {theme === 'system' ? <Monitor className="h-5 w-5" /> : theme === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </header>

      {/* Backdrop for Mobile Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-xs md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar / Mobile Nav Drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card px-4 py-6 flex flex-col justify-between transition-transform duration-200 ease-in-out md:static md:translate-x-0 shrink-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex flex-col flex-1">
          <div className="flex items-center justify-between mb-8 px-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-google-sans">ZKZZK</h1>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={cycleTheme}
                className="text-muted-foreground hover:text-foreground hidden md:flex"
                title={theme === 'system' ? t('layout.systemTheme') : theme === 'light' ? t('layout.lightMode') : t('layout.darkMode')}
              >
                {theme === 'system' ? <Monitor className="h-5 w-5" /> : theme === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileNavOpen(false)}
                className="text-muted-foreground hover:text-foreground md:hidden"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
              return (
                <Link key={item.path} to={item.path} onClick={() => setMobileNavOpen(false)}>
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    className="w-full justify-start gap-3"
                  >
                    <Icon className="h-5 w-5" />
                    {t(item.key)}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="border-t border-border pt-4 mt-6">
          <div className="px-2 mb-2">
            <p className="text-sm text-muted-foreground">v{user.version || pkg.version}</p>
            {latestVersion && latestVersion !== (user.version || pkg.version) && (
              <a href="https://github.com/k-atusa/zkzzk/releases" target="_blank" rel="noreferrer" className="text-[11px] font-medium text-amber-500 hover:text-amber-600 block mt-0.5">
                {t('layout.newVersionAvailable', { version: latestVersion })}
              </a>
            )}
          </div>
          <div className="px-2 mb-4 text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
            {t('layout.loggedInAs')} <span className="text-foreground font-medium truncate max-w-[80px]">{user.username}</span>
            {user.is_admin && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20 font-medium">
                {t('layout.admin')}
              </span>
            )}
          </div>
          <Button variant="ghost" className="w-full justify-start text-red-600 dark:text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/10 gap-3" onClick={handleLogout}>
            <LogOut className="h-5 w-5" />
            {t('layout.logout')}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background p-4 sm:p-6 md:p-8">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

