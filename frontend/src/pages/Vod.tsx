import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Search, Download } from 'lucide-react';
import api from '@/api';

export const Vod = () => {
  const [url, setUrl] = useState('');
  const [vodInfo, setVodInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hasCookies, setHasCookies] = useState(false);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const res = await api.get('/auth/me');
        setHasCookies(res.data.has_cookies);
      } catch (e) {}
    };
    fetchMe();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasCookies) {
      toast.error('먼저 설정 메뉴에서 치지직 쿠키를 설정해주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/vod/get_vod_info', { vod_url: url });
      setVodInfo(res.data);
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

    try {
      await api.post('/vod/download_vod', {
        download_url: resInfo.download_url,
        video_info: vodInfo.video_info,
        resolution: resInfo
      });
      toast.success('다운로드가 시작되었습니다. 녹화본 페이지에서 확인하세요.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || '다운로드 요청 실패');
    }
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
