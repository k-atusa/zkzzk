import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Search, Download } from 'lucide-react';
import api from '@/api';

export function Vod() {
  const [url, setUrl] = useState('');
  const [vodInfo, setVodInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vodInfo.resolutions.map((res: any) => (
                <Card key={res.resolution} className="flex flex-col justify-between bg-muted/40">
                  <CardContent className="pt-6">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-xl font-bold">{res.resolution}</span>
                      <span className="text-sm text-muted-foreground">{res.quality}</span>
                    </div>
                    <div className="text-sm text-muted-foreground mb-6">
                      예상 크기: {res.estimated_size_mb ? `${res.estimated_size_mb} MB` : '알 수 없음'}
                    </div>
                    <Button className="w-full" onClick={() => handleDownload(res.resolution)}>
                      <Download className="mr-2 h-4 w-4" /> 다운로드
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
