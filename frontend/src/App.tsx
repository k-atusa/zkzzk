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
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
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
