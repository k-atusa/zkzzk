import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Search, Download } from 'lucide-react';
import api from '@/api';
import { useLanguage } from '../lib/i18n';

export const Vod = () => {
  const [url, setUrl] = useState('');
  const [vodInfo, setVodInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hasCookies, setHasCookies] = useState(false);
  const [userResolution, setUserResolution] = useState<string>('ask');
  const [overwriteConfirm, setOverwriteConfirm] = useState<{ resInfo: any; videoInfo: any } | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await api.get('/auth/user-settings');
        setHasCookies(!!(res.data.nid_aut && res.data.nid_ses));
        if (res.data.vod_resolution) {
          setUserResolution(res.data.vod_resolution);
        }
      } catch (e) { }
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
        setOverwriteConfirm({ resInfo, videoInfo });
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
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('vod.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('vod.searchDesc')}</p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
        <Input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={t('vod.searchPlaceholder')}
          required
          className="flex-1"
        />
        <Button type="submit" disabled={loading} className="w-full sm:w-auto shrink-0">
          <Search className="mr-2 h-4 w-4" /> {loading ? t('vod.searching') : t('vod.searchBtn')}
        </Button>
      </form>

      {vodInfo && (
        <Card className="overflow-hidden py-0 gap-0">
          <CardHeader className="border-b border-border/50 py-4 px-5">
            <CardTitle className="text-lg sm:text-xl">{vodInfo.video_info.title}</CardTitle>
            <CardDescription>
              {vodInfo.video_info.author} • {vodInfo.video_info.category}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="px-5 py-2.5 text-xs font-medium text-muted-foreground border-b border-border/50">
              {t('vod.selectQuality')}
            </div>
            <div className="divide-y divide-border/50">
              {vodInfo.resolutions.map((res: any) => (
                <button
                  key={res.resolution}
                  type="button"
                  className="w-full flex justify-between items-center px-5 py-3.5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => handleDownload(res.resolution)}
                >
                  <span className="font-semibold text-sm text-foreground">{res.resolution}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span className="text-xs font-medium">{res.width && res.height ? `${res.width}x${res.height}` : res.quality}</span>
                    <Download className="h-4 w-4" />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!overwriteConfirm} onOpenChange={(open) => { if (!open) setOverwriteConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('vod.fileExistsTitle')}</DialogTitle>
            <DialogDescription>{t('vod.fileExistsDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setOverwriteConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => {
              if (overwriteConfirm) {
                executeDownload(overwriteConfirm.resInfo, overwriteConfirm.videoInfo, true);
                setOverwriteConfirm(null);
              }
            }}>
              {t('vod.overwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
