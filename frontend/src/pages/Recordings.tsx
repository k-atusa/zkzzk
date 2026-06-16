import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2, Video, Film, FileText, MonitorPlay, Play, AlertCircle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import api from '@/api';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import mpegts from 'mpegts.js';
import pkg from '../../package.json';



// Self-contained Video Player for .ts and .mp4 formats
const VideoPlayer = ({ filename }: { filename: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  const videoUrl = `http://localhost:5001/api/recordings/download/${filename}`;
  const isTs = filename.endsWith('.ts');

  useEffect(() => {
    if (!videoRef.current) return;
    setError(null);

    if (isTs) {
      if (mpegts.getFeatureList().msePlayback) {
        try {
          const player = mpegts.createPlayer({
            type: 'mpegts',
            isLive: false,
            url: videoUrl,
            withCredentials: true,
          }, {
            lazyLoad: false,
            enableStashBuffer: false
          });

          player.attachMediaElement(videoRef.current);
          player.load();
          playerRef.current = player;

          const playPromise = player.play();
          if (playPromise instanceof Promise) {
            playPromise.catch((e: any) => {
              console.warn("Autoplay prevented:", e);
            });
          }

          player.on(mpegts.Events.ERROR, (type, detail, info) => {
            console.error('mpegts error:', type, detail, info);
            setError(`재생 중 오류가 발생했습니다: ${type} (${detail})`);
          });
        } catch (e: any) {
          setError(`플레이어 초기화 실패: ${e.message}`);
        }

        return () => {
          if (playerRef.current) {
            playerRef.current.destroy();
            playerRef.current = null;
          }
        };
      } else {
        setError('이 브라우저는 MPEG-TS 재생을 지원하지 않습니다.');
      }
    }
  }, [videoUrl, isTs]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-destructive bg-muted p-6 text-center rounded-lg">
        <AlertCircle className="h-10 w-10 text-destructive/80" />
        <div>
          <p className="font-semibold text-sm">{error}</p>
          <p className="text-xs text-muted-foreground mt-1">대체 방법: 우측의 다운로드 버튼을 이용해 다운로드 후 PC에서 재생해 주세요.</p>
        </div>
      </div>
    );
  }

  if (isTs) {
    return (
      <video
        ref={videoRef}
        controls
        autoPlay
        crossOrigin="use-credentials"
        className="w-full h-full object-contain"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      src={videoUrl}
      controls
      autoPlay
      crossOrigin="use-credentials"
      className="w-full h-full object-contain"
    />
  );
};

export const Recordings = () => {
  const [recordings, setRecordings] = useState<Record<string, any[]>>({});
  const [activeTab, setActiveTab] = useState<'live' | 'vod' | 'other'>('live');
  const [playingVideo, setPlayingVideo] = useState<{ filename: string; title: string } | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    description: string | React.ReactNode;
    onConfirm: () => void;
    isDestructive?: boolean;
  } | null>(null);
  
  const [uploadConfig, setUploadConfig] = useState<{
    id: string;
    filename: string;
    title: string;
    description: string;
  } | null>(null);

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

  const handleDelete = (filename: string) => {
    setConfirmConfig({
      title: '녹화본 삭제',
      description: '정말 이 녹화본 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.post('/recordings/delete', { filename });
          toast.success('삭제되었습니다.');
          fetchRecordings();
        } catch (error: any) {
          toast.error(error.response?.data?.message || '삭제 실패');
        }
      }
    });
  };

  const handleYoutubeUploadClick = (id: string, filename: string) => {
    let defaultTitle = filename.split('/').pop() || filename;
    defaultTitle = defaultTitle.replace(/\.(mp4|ts|mkv|avi)$/i, '');
    setUploadConfig({
      id,
      filename,
      title: defaultTitle,
      description: `Automatically uploaded via ZKZZK version ${pkg.version}`
    });
  };

  const submitYoutubeUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadConfig) return;
    try {
      await api.post('/youtube/upload', { 
        recordingId: uploadConfig.id, 
        filePath: uploadConfig.filename, 
        title: uploadConfig.title,
        description: uploadConfig.description
      });
      toast.success('유튜브 업로드가 시작되었습니다.');
      setUploadConfig(null);
      fetchRecordings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '유튜브 업로드 요청 실패');
    }
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
                    <TableHead className="pl-6 py-3">방송 정보</TableHead>
                    <TableHead className="w-28 py-3">파일 크기</TableHead>
                    <TableHead className="w-48 py-3">녹화 완료 일시</TableHead>
                    <TableHead className="text-right pr-6 py-3 w-40">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recs.map((r, i) => (
                    <TableRow key={i} className="hover:bg-muted/10 transition-colors">
                      <TableCell className="pl-6 py-4 font-medium">
                        <div className="flex flex-col gap-1">
                          <div 
                            className="font-semibold text-foreground text-sm line-clamp-1 cursor-pointer hover:underline hover:text-primary transition-colors"
                            onClick={() => setPlayingVideo({ filename: r.filename, title: r.title })}
                          >
                            {r.title}
                          </div>
                          {r.youtube_status && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {r.youtube_status === 'DUPLICATE_PENDING' && (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 border border-yellow-500/20">
                                  <AlertCircle className="h-3 w-3" /> 유튜브 업로드 대기 (중복 의심)
                                </span>
                              )}
                              {r.youtube_status === 'UPLOADING' && (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-500/20">
                                  <Loader2 className="h-3 w-3 animate-spin" /> 유튜브 업로드 중
                                </span>
                              )}
                              {r.youtube_status === 'UPLOADED' && (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 border border-green-500/20">
                                  <CheckCircle2 className="h-3 w-3" /> 유튜브 업로드 완료
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm font-medium">{r.size_mb} MB</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(r.created_at), 'PPP pp', { locale: ko })}
                      </TableCell>
                      <TableCell className="text-right pr-6 py-4 flex justify-end gap-2">
                        {r.youtube_status !== 'UPLOADING' && r.youtube_status !== 'UPLOADED' && (
                          <Button variant="outline" size="sm" onClick={() => handleYoutubeUploadClick(r.id || '', r.filename)} className="h-8 w-8 p-0 bg-transparent hover:bg-primary/10 border-border/50 hover:border-primary/50 transition-colors" title="유튜브 업로드">
                            <Upload className="h-5 w-5 text-foreground" />
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => handleDelete(r.filename)} className="h-8 w-8 p-0 bg-transparent hover:bg-red-500/10 border-border/50 hover:border-red-500/50 transition-colors" title="삭제">
                          <Trash2 className="h-4 w-4 text-red-500" />
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

      {/* Video Player Modal */}
      <Dialog open={!!playingVideo} onOpenChange={(open) => { if (!open) setPlayingVideo(null); }}>
        <DialogContent className="sm:max-w-4xl p-6 gap-4">
          <DialogHeader className="pb-2 border-b border-border/50">
            <DialogTitle className="text-lg font-bold pr-6 line-clamp-1 flex items-center gap-2 text-foreground">
              <Play className="h-5 w-5 text-primary fill-primary/10" />
              {playingVideo?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black flex items-center justify-center shadow-inner ring-1 ring-white/5">
            {playingVideo && (
              <VideoPlayer filename={playingVideo.filename} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Youtube Upload Modal */}
      <Dialog open={!!uploadConfig} onOpenChange={(open) => { if (!open) setUploadConfig(null); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitYoutubeUpload}>
            <DialogHeader>
              <DialogTitle>YouTube 영상 업로드</DialogTitle>
              <DialogDescription>
                업로드할 영상의 제목과 설명을 입력해주세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="yt-title">영상 제목</Label>
                <Input
                  id="yt-title"
                  value={uploadConfig?.title || ''}
                  onChange={(e) => setUploadConfig(prev => prev ? { ...prev, title: e.target.value } : null)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yt-desc">설명</Label>
                <textarea
                  id="yt-desc"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={uploadConfig?.description || ''}
                  onChange={(e) => setUploadConfig(prev => prev ? { ...prev, description: e.target.value } : null)}
                />
              </div>
            </div>
            <DialogFooter className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setUploadConfig(null)}>
                취소
              </Button>
              <Button type="submit">
                업로드
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmConfig} onOpenChange={(open) => { if (!open) setConfirmConfig(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmConfig?.title}</DialogTitle>
            <DialogDescription>
              {confirmConfig?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmConfig(null)}>
              취소
            </Button>
            <Button variant={confirmConfig?.isDestructive ? "destructive" : "default"} onClick={() => {
              confirmConfig?.onConfirm();
              setConfirmConfig(null);
            }}>
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
