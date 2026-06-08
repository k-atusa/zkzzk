import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Trash2, StopCircle, RefreshCw } from 'lucide-react';
import api from '@/api';

export function Live() {
  const [streamers, setStreamers] = useState<any[]>([]);
  const [newUrl, setNewUrl] = useState('');

  const fetchStreamers = async () => {
    try {
      const res = await api.get('/streamers');
      setStreamers(res.data);
    } catch (e) {
      toast.error('스트리머 목록을 불러오는데 실패했습니다.');
    }
  };

  useEffect(() => {
    fetchStreamers();
    const interval = setInterval(fetchStreamers, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/streamers/add_streamer', { channel_url: newUrl });
      toast.success('스트리머가 추가되었습니다.');
      setNewUrl('');
      fetchStreamers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '추가 실패');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      await api.post(`/streamers/remove_streamer/${id}`);
      toast.success('삭제되었습니다.');
      fetchStreamers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '삭제 실패');
    }
  };

  const handleStopRecording = async (id: number) => {
    if (!confirm('녹화를 중지하시겠습니까?')) return;
    try {
      await api.post(`/streamers/stop_recording/${id}`);
      toast.success('녹화가 중지되었습니다.');
      fetchStreamers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '중지 실패');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">스트리머 관리</h2>
        <Button variant="outline" onClick={fetchStreamers}>
          <RefreshCw className="mr-2 h-4 w-4" /> 새로고침
        </Button>
      </div>

      <Card className="bg-neutral-900 border-neutral-800">
        <CardHeader>
          <CardTitle>새 스트리머 추가</CardTitle>
          <CardDescription className="text-neutral-400">치지직 채널 URL을 입력하여 자동 녹화를 설정하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex space-x-2">
            <Input
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="https://chzzk.naver.com/..."
              className="bg-neutral-950 border-neutral-800"
              required
            />
            <Button type="submit" className="bg-white text-black hover:bg-neutral-200">
              <Plus className="mr-2 h-4 w-4" /> 추가
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-neutral-900 border-neutral-800">
        <CardHeader>
          <CardTitle>등록된 스트리머</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-neutral-800">
                <TableHead className="text-neutral-400">닉네임</TableHead>
                <TableHead className="text-neutral-400">상태</TableHead>
                <TableHead className="text-neutral-400">방송 제목</TableHead>
                <TableHead className="text-neutral-400 text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {streamers.length === 0 ? (
                <TableRow className="border-neutral-800">
                  <TableCell colSpan={4} className="text-center py-6 text-neutral-500">등록된 스트리머가 없습니다.</TableCell>
                </TableRow>
              ) : streamers.map((s) => (
                <TableRow key={s.id} className="border-neutral-800">
                  <TableCell className="font-medium">
                    <a href={s.channel_url} target="_blank" rel="noreferrer" className="hover:underline">{s.nickname}</a>
                  </TableCell>
                  <TableCell>
                    {s.is_recording ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500">
                        <span className="w-2 h-2 mr-1.5 bg-red-500 rounded-full animate-pulse"></span>
                        녹화중
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-800 text-neutral-400">
                        대기중
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-neutral-400" title={s.current_broadcast_title}>
                    {s.current_broadcast_title || '-'}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {s.is_recording && (
                      <Button variant="destructive" size="sm" onClick={() => handleStopRecording(s.id)}>
                        <StopCircle className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => handleRemove(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
