import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Live } from './pages/Live';
import { Recordings } from './pages/Recordings';
import { Vod } from './pages/Vod';
import { Settings } from './pages/Settings';
import { Toaster } from '@/components/ui/sonner';
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    const savedTheme = (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system';
    
    const applyTheme = (t: 'light' | 'dark' | 'system') => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      if (t === 'system') {
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(systemPrefersDark ? 'dark' : 'light');
      } else {
        root.classList.add(t);
      }
    };

    applyTheme(savedTheme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      const current = localStorage.getItem('theme') || 'system';
      if (current === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Live />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/vod" element={<Vod />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
      <Toaster theme="dark" />
    </BrowserRouter>
  );
}

export default App;
