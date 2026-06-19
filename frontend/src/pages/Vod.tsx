import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Search, Download, AlertTriangle } from 'lucide-react';
import api from '@/api';

export const Vod = () => {
  const [url, setUrl] = useState('');
  const [vodInfo, setVodInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hasCookies, setHasCookies] = useState(false);
  const [userResolution, setUserResolution] = useState<string>('ask');

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const res = await api.get('/auth/me');
        setHasCookies(res.data.has_cookies);
        if (res.data.vod_resolution) {
          setUserResolution(res.data.vod_resolution);
        }
      } catch (e) {}
    };
    fetchMe();
  }, []);

  const executeDownload = async (resInfo: any, videoInfo: any, overwrite: boolean = false) => {
    try {
      await api.post('/vod/download_vod', {
        download_url: resInfo.download_url,
        video_info: videoInfo,
        resolution: resInfo,
        overwrite
      });
      toast.success(`[${resInfo.quality}] 다운로드가 시작되었습니다. 녹화본 페이지에서 확인하세요.`);
      setUrl('');
      setVodInfo(null);
    } catch (error: any) {
      if (error.response?.data?.message === 'FILE_EXISTS') {
        toast.custom((t) => (
          <div className="flex flex-col gap-3 w-full bg-background border border-border p-4 rounded-lg shadow-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-foreground text-sm">이미 동일한 파일이 존재합니다.</span>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  기존 파일을 삭제하고 처음부터 다시 다운로드하시겠습니까?
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <Button size="sm" variant="outline" onClick={() => toast.dismiss(t)}>
                취소
              </Button>
              <Button size="sm" onClick={() => {
                toast.dismiss(t);
                executeDownload(resInfo, videoInfo, true);
              }}>
                덮어쓰기
              </Button>
            </div>
          </div>
        ), { duration: Number.POSITIVE_INFINITY, id: 'confirm-toast' });
      } else {
        toast.error(error.response?.data?.message || '다운로드 요청 실패');
      }
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasCookies) {
      toast.error('먼저 설정 메뉴에서 치지직 쿠키를 설정해주세요.');
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
          toast.info(`요청하신 ${targetQuality} 화질이 없어 ${targetRes.quality} 화질로 다운로드합니다.`);
        }

        if (targetRes) {
          await executeDownload(targetRes, fetchedVodInfo.video_info);
        }
      } else {
        setVodInfo(fetchedVodInfo);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || '정보를 가져올 수 없습니다.');
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
      <h2 className="text-3xl font-bold tracking-tight">VOD 다운로더</h2>

      <Card>
        <CardHeader>
          <CardTitle>치지직 VOD 검색</CardTitle>
          <CardDescription>다운로드할 VOD URL을 입력하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex space-x-2">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://chzzk.naver.com/video/..."
              required
            />
            <Button type="submit" disabled={loading}>
              <Search className="mr-2 h-4 w-4" /> {loading ? '검색중...' : '검색'}
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
              <h3 className="text-sm font-medium text-muted-foreground mb-1">다운로드 화질 선택</h3>
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
