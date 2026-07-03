import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Search, Download, AlertTriangle } from 'lucide-react';
import api from '@/api';
import { useLanguage } from '../lib/i18n';

export const Vod = () => {
  const [url, setUrl] = useState('');
  const [vodInfo, setVodInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hasCookies, setHasCookies] = useState(false);
  const [userResolution, setUserResolution] = useState<string>('ask');
  const { t } = useLanguage();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await api.get('/auth/user-settings');
        setHasCookies(!!(res.data.nid_aut && res.data.nid_ses));
        if (res.data.vod_resolution) {
          setUserResolution(res.data.vod_resolution);
        }
      } catch (e) {}
    };
    fetchSettings();
  }, []);

  const executeDownload = async (resInfo: any, videoInfo: any, overwrite: boolean = false) => {
    try {
      await api.post('/vod/download_vod', {
        download_url: resInfo.download_url,
        video_info: videoInfo,
        resolution: resInfo,
        overwrite
      });
      toast.success(t('vod.downloadStarted', { quality: resInfo.quality }));
      setUrl('');
      setVodInfo(null);
    } catch (error: any) {
      if (error.response?.data?.message === 'FILE_EXISTS') {
        toast.custom((tActive) => (
          <div className="flex flex-col gap-3 w-full bg-background border border-border p-4 rounded-lg shadow-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-foreground text-sm">{t('vod.fileExistsTitle')}</span>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  {t('vod.fileExistsDesc')}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <Button size="sm" variant="outline" onClick={() => toast.dismiss(tActive)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => {
                toast.dismiss(tActive);
                executeDownload(resInfo, videoInfo, true);
              }}>
                {t('vod.overwrite')}
              </Button>
            </div>
          </div>
        ), { duration: Number.POSITIVE_INFINITY, id: 'confirm-toast' });
      } else {
        toast.error(error.response?.data?.message || t('vod.downloadRequestFailed'));
      }
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasCookies) {
      toast.error(t('vod.cookieWarning'));
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/vod/get_vod_info', { vod_url: url });
      const fetchedVodInfo = res.data;

      if (userResolution && userResolution !== 'ask') {
        const targetQuality = userResolution;
        let targetRes = fetchedVodInfo.resolutions.find((r: any) => r.quality === targetQuality);
        
        if (!targetRes && fetchedVodInfo.resolutions.length > 0) {
          targetRes = fetchedVodInfo.resolutions[0];
          toast.info(t('vod.qualityFallbackInfo', { quality: targetQuality, fallbackQuality: targetRes.quality }));
        }

        if (targetRes) {
          await executeDownload(targetRes, fetchedVodInfo.video_info);
        }
      } else {
        setVodInfo(fetchedVodInfo);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('vod.fetchInfoFailed'));
      setVodInfo(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (resolution: string) => {
    const resInfo = vodInfo.resolutions.find((r: any) => r.resolution === resolution);
    if (!resInfo) return;
    await executeDownload(resInfo, vodInfo.video_info);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">{t('vod.title')}</h2>

      <Card>
        <CardHeader>
          <CardTitle>{t('vod.searchTitle')}</CardTitle>
          <CardDescription>{t('vod.searchDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex space-x-2">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('vod.searchPlaceholder')}
              required
            />
            <Button type="submit" disabled={loading}>
              <Search className="mr-2 h-4 w-4" /> {loading ? t('vod.searching') : t('vod.searchBtn')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {vodInfo && (
        <Card>
          <CardHeader>
            <CardTitle>{vodInfo.video_info.title}</CardTitle>
            <CardDescription>
              {vodInfo.video_info.author} • {vodInfo.video_info.category}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 max-w-sm">
              <h3 className="text-sm font-medium text-muted-foreground mb-1">{t('vod.selectQuality')}</h3>
              {vodInfo.resolutions.map((res: any) => (
                <Button 
                   key={res.resolution} 
                   variant="outline" 
                   className="w-full flex justify-between items-center h-12 px-4 hover:border-primary/50 hover:bg-primary/5 transition-colors" 
                   onClick={() => handleDownload(res.resolution)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base">{res.resolution}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground group-hover:text-primary">
                    <span className="text-xs font-medium">{res.width && res.height ? `${res.width}x${res.height}` : res.quality}</span>
                    <Download className="h-4 w-4" />
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
