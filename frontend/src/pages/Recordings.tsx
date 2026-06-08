import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Download, Trash2, Video, Film, FileText, MonitorPlay } from 'lucide-react';
import api from '@/api';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export const Recordings = () => {
  const [recordings, setRecordings] = useState<Record<string, any[]>>({});
  const [activeTab, setActiveTab] = useState<'live' | 'vod' | 'other'>('live');

  const fetchRecordings = async () => {
    try {
      const res = await api.get('/recordings');
      setRecordings(res.data);
    } catch (e) {
      toast.error('녹화본 목록을 불러오는데 실패했습니다.');
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  // Parse and separate recordings into categories
  const liveRecordings: Record<string, any[]> = {};
  const vodRecordings: Record<string, any[]> = {};
  const otherRecordings: Record<string, any[]> = {};

  Object.entries(recordings).forEach(([streamerName, recs]) => {
    if (streamerName.endsWith(' (라이브)')) {
      const cleanName = streamerName.replace(' (라이브)', '');
      liveRecordings[cleanName] = recs;
    } else if (streamerName.endsWith(' (다시보기)') || streamerName === '다시보기 (기존)') {
      const cleanName = streamerName.replace(' (다시보기)', '');
      vodRecordings[cleanName] = recs;
    } else {
      otherRecordings[streamerName] = recs;
    }
  });

  const liveCount = Object.values(liveRecordings).reduce((acc, curr) => acc + curr.length, 0);
  const vodCount = Object.values(vodRecordings).reduce((acc, curr) => acc + curr.length, 0);
  const otherCount = Object.values(otherRecordings).reduce((acc, curr) => acc + curr.length, 0);

  // Auto-switch tab if the default 'live' tab is empty but others have contents
  useEffect(() => {
    if (Object.keys(recordings).length > 0) {
      const hasLive = Object.keys(recordings).some(k => k.endsWith(' (라이브)'));
      const hasVod = Object.keys(recordings).some(k => k.endsWith(' (다시보기)') || k === '다시보기 (기존)');
      if (!hasLive && hasVod) {
        setActiveTab('vod');
      } else if (!hasLive && !hasVod && otherCount > 0) {
        setActiveTab('other');
      }
    }
  }, [recordings, otherCount]);

  const handleDelete = async (filename: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      await api.post('/recordings/delete', { filename });
      toast.success('삭제되었습니다.');
      fetchRecordings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '삭제 실패');
    }
  };

  const handleDownload = (filename: string) => {
    window.location.href = `http://localhost:5001/api/recordings/download/${filename}`;
  };

  const currentCategoryRecordings = 
    activeTab === 'live' ? liveRecordings :
    activeTab === 'vod' ? vodRecordings : otherRecordings;

  const hasRecordingsInActiveTab = Object.keys(currentCategoryRecordings).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">녹화본 관리</h2>
      </div>

      {/* Modern Tabs Navigation */}
      <div className="flex border-b border-border space-x-6">
        <button
          onClick={() => setActiveTab('live')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 relative ${
            activeTab === 'live'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Video className="h-4 w-4" />
          라이브 영상
          {liveCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-primary/10 text-primary">
              {liveCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('vod')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 relative ${
            activeTab === 'vod'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Film className="h-4 w-4" />
          다시보기 (VOD)
          {vodCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-primary/10 text-primary">
              {vodCount}
            </span>
          )}
        </button>
        {otherCount > 0 && (
          <button
            onClick={() => setActiveTab('other')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 relative ${
              activeTab === 'other'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="h-4 w-4" />
            기타 파일
            <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-primary/10 text-primary">
              {otherCount}
            </span>
          </button>
        )}
      </div>

      {/* Recordings List */}
      {!hasRecordingsInActiveTab ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
            <MonitorPlay className="h-10 w-10 text-muted-foreground/50" />
            <p>선택한 카테고리에 저장된 녹화본이 없습니다.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(currentCategoryRecordings).map(([streamerName, recs]) => (
          <Card key={streamerName} className="overflow-hidden pt-0">
            <CardHeader className="bg-muted/10 border-b border-border/50 py-4">
              <CardTitle className="text-lg font-bold text-foreground">{streamerName}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/5">
                  <TableRow>
                    <TableHead className="pl-6 py-3">방송 정보 / 파일명</TableHead>
                    <TableHead className="w-28 py-3">파일 크기</TableHead>
                    <TableHead className="w-48 py-3">녹화 완료 일시</TableHead>
                    <TableHead className="text-right pr-6 py-3 w-32">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recs.map((r, i) => (
                    <TableRow key={i} className="hover:bg-muted/10 transition-colors">
                      <TableCell className="pl-6 py-4 font-medium">
                        <div className="font-semibold text-foreground text-sm line-clamp-1">{r.title}</div>
                        {r.title !== r.display_name && (
                          <div className="text-xs text-muted-foreground mt-1 font-mono break-all">{r.display_name}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm font-medium">{r.size_mb} MB</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(r.created_at), 'PPP pp', { locale: ko })}
                      </TableCell>
                      <TableCell className="text-right pr-6 py-4 space-x-2">
                        <Button variant="secondary" size="sm" onClick={() => handleDownload(r.filename)} className="h-8 w-8 p-0" title="다운로드">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(r.filename)} className="h-8 w-8 p-0" title="삭제">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
