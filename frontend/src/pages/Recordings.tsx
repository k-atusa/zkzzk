import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Download, Trash2 } from 'lucide-react';
import api from '@/api';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export function Recordings() {
  const [recordings, setRecordings] = useState<Record<string, any[]>>({});

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

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">녹화본 관리</h2>

      {Object.keys(recordings).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            저장된 녹화본이 없습니다.
          </CardContent>
        </Card>
      ) : (
        Object.entries(recordings).map(([streamerName, recs]) => (
          <Card key={streamerName}>
            <CardHeader>
              <CardTitle>{streamerName}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>파일명</TableHead>
                    <TableHead>크기</TableHead>
                    <TableHead>날짜</TableHead>
                    <TableHead className="text-right">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recs.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.display_name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.size_mb} MB</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(r.created_at), 'PPP pp', { locale: ko })}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="secondary" size="sm" onClick={() => handleDownload(r.filename)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(r.filename)}>
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
