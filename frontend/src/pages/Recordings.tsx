import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2, Video, Film, FileText, MonitorPlay, Play, AlertCircle, CheckCircle2, Loader2, Upload, AlertTriangle, Search, X } from 'lucide-react';
import api from '@/api';
import { format } from 'date-fns';
import { ko, enUS } from 'date-fns/locale';
import mpegts from 'mpegts.js';
import pkg from '../../package.json';
import { useLanguage } from '../lib/i18n';

// Self-contained Video Player for .ts and .mp4 formats
const VideoPlayer = ({ filename }: { filename: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  const videoUrl = `/api/recordings/download/${filename}`;
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
            setError(t('recordings.playbackError', { type, detail }));
          });
        } catch (e: any) {
          setError(t('recordings.initFailed', { message: e.message }));
        }

        return () => {
          if (playerRef.current) {
            playerRef.current.destroy();
            playerRef.current = null;
          }
        };
      } else {
        setError(t('recordings.mseUnsupported'));
      }
    }
  }, [videoUrl, isTs, t]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-destructive bg-muted p-6 text-center rounded-lg">
        <AlertCircle className="h-10 w-10 text-destructive/80" />
        <div>
          <p className="font-semibold text-sm">{error}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('recordings.alternativePlay')}</p>
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

  const [uploadConfig, setUploadConfig] = useState<{
    id: string;
    filename: string;
    title: string;
    description: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [vodProgress, setVodProgress] = useState<Record<string, string>>({});
  const { t, language } = useLanguage();

  const fetchRecordings = async () => {
    try {
      const res = await api.get('/recordings');
      setRecordings(res.data);
    } catch (e) {
      toast.error(t('recordings.loadFailed'));
    }
  };

  useEffect(() => {
    fetchRecordings();

    const youtubeEventSource = new EventSource('/api/events/youtube');
    const vodEventSource = new EventSource('/api/events/vod');

    youtubeEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'YOUTUBE_UPLOAD_COMPLETE') {
          const { recordingId, video_id, isDeleted } = data.payload;

          toast.success(
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-foreground">{t('recordings.uploadComplete')}</span>
              {video_id && (
                <a
                  href={`https://youtu.be/${video_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 underline text-sm hover:text-blue-600 transition-colors mt-1"
                >
                  {t('recordings.viewOnYoutube')}
                </a>
              )}
            </div>
          );

          setRecordings(prev => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
              if (isDeleted) {
                next[key] = next[key].filter(r => r.id !== recordingId);
                // Clean up empty streamer keys if needed
                if (next[key].length === 0) {
                  delete next[key];
                }
              } else {
                next[key] = next[key].map(r =>
                  r.id === recordingId
                    ? { ...r, youtube_status: 'UPLOADED', youtube_video_id: video_id }
                    : r
                );
              }
            }
            return next;
          });
        }
      } catch (e) {
        console.error('Failed to parse SSE event', e);
      }
    };

    vodEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'VOD_DOWNLOAD_PROGRESS') {
          const { recordingId, progress } = data.payload;
          if (progress === '완료') {
            setVodProgress(prev => {
              const next = { ...prev };
              delete next[recordingId];
              return next;
            });
            setRecordings(prev => {
              const next = { ...prev };
              for (const key of Object.keys(next)) {
                next[key] = next[key].map(r => r.id === recordingId ? { ...r, is_recording: false } : r);
              }
              return next;
            });
            fetchRecordings();
          } else {
            setVodProgress(prev => ({ ...prev, [recordingId]: progress }));
          }
        }
      } catch (e) {
        console.error('Failed to parse VOD SSE event', e);
      }
    };

    return () => {
      youtubeEventSource.close();
      vodEventSource.close();
    };
  }, [t]);

  const [searchQuery, setSearchQuery] = useState('');

  // Helper to filter recordings by streamer name or video title/filename
  const filterRecordings = (recsMap: Record<string, any[]>) => {
    if (!searchQuery.trim()) return recsMap;
    const query = searchQuery.toLowerCase().trim();
    const filtered: Record<string, any[]> = {};

    Object.entries(recsMap).forEach(([streamerName, recs]) => {
      const isStreamerMatch = streamerName.toLowerCase().includes(query);
      if (isStreamerMatch) {
        filtered[streamerName] = recs;
      } else {
        const matchingRecs = recs.filter(r =>
          (r.title && r.title.toLowerCase().includes(query)) ||
          (r.filename && r.filename.toLowerCase().includes(query))
        );
        if (matchingRecs.length > 0) {
          filtered[streamerName] = matchingRecs;
        }
      }
    });
    return filtered;
  };

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

  const filteredLiveRecordings = filterRecordings(liveRecordings);
  const filteredVodRecordings = filterRecordings(vodRecordings);
  const filteredOtherRecordings = filterRecordings(otherRecordings);

  const liveCount = Object.values(filteredLiveRecordings).reduce((acc, curr) => acc + curr.length, 0);
  const vodCount = Object.values(filteredVodRecordings).reduce((acc, curr) => acc + curr.length, 0);
  const otherCount = Object.values(filteredOtherRecordings).reduce((acc, curr) => acc + curr.length, 0);
  const totalOtherCount = Object.values(otherRecordings).reduce((acc, curr) => acc + curr.length, 0);

  // Auto-switch tab if the default 'live' tab is empty but others have contents
  useEffect(() => {
    if (Object.keys(recordings).length > 0) {
      const hasLive = Object.keys(recordings).some(k => k.endsWith(' (라이브)'));
      const hasVod = Object.keys(recordings).some(k => k.endsWith(' (다시보기)') || k === '다시보기 (기존)');
      if (!hasLive && hasVod) {
        setActiveTab('vod');
      } else if (!hasLive && !hasVod && totalOtherCount > 0) {
        setActiveTab('other');
      }
    }
  }, [recordings, totalOtherCount]);

  const handleDelete = (filename: string) => {
    toast.custom((tActive) => (
      <div className="flex flex-col gap-3 w-full bg-background border border-border p-4 rounded-lg shadow-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground text-sm">{t('recordings.deleteConfirmTitle')}</span>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {t('recordings.deleteConfirmDesc')}
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <Button size="sm" variant="outline" onClick={() => toast.dismiss(tActive)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" variant="destructive" onClick={async () => {
            toast.dismiss(tActive);
            try {
              await api.post('/recordings/delete', { filename });
              toast.success(t('live.deleteSuccess'));
              fetchRecordings();
            } catch (error: any) {
              toast.error(error.response?.data?.message || t('recordings.deleteFailed'));
            }
          }}>
            {t('recordings.deleteBtn')}
          </Button>
        </div>
      </div>
    ), { duration: Number.POSITIVE_INFINITY, id: 'confirm-toast' });
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
    if (!uploadConfig || isUploading) return;
    setIsUploading(true);
    try {
      const res = await api.post('/youtube/upload', {
        recordingId: uploadConfig.id,
        filePath: uploadConfig.filename,
        title: uploadConfig.title,
        description: uploadConfig.description
      });
      if (res.data.already_uploaded) {
        toast.success(
          <div className="flex flex-col gap-1">
            <span>{t('recordings.alreadyUploaded')}</span>
            <a
              href={`https://youtu.be/${res.data.video_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-500 underline text-sm hover:text-blue-600 transition-colors"
            >
              {t('recordings.viewOnYoutube')}
            </a>
          </div>
        );
      } else {
        toast.success(t('recordings.uploadSuccess'));
      }
      setUploadConfig(null);
      fetchRecordings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('recordings.uploadFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  const currentCategoryRecordings =
    activeTab === 'live' ? filteredLiveRecordings :
      activeTab === 'vod' ? filteredVodRecordings : filteredOtherRecordings;

  const hasRecordingsInActiveTab = Object.keys(currentCategoryRecordings).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('recordings.title')}</h2>
      </div>

      {/* Modern Tabs & Search Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-3 sm:pb-0">
        <div className="flex space-x-4 sm:space-x-6 overflow-x-auto whitespace-nowrap no-scrollbar pb-1 sm:pb-0">
          <button
            onClick={() => setActiveTab('live')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 relative ${activeTab === 'live'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            <Video className="h-4 w-4" />
            {t('recordings.liveTab')}
            {liveCount > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
                {liveCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('vod')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 relative ${activeTab === 'vod'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            <Film className="h-4 w-4" />
            {t('recordings.vodTab')}
            {vodCount > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
                {vodCount}
              </span>
            )}
          </button>
          {otherCount > 0 && (
            <button
              onClick={() => setActiveTab('other')}
              className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 relative ${activeTab === 'other'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
            >
              <FileText className="h-4 w-4" />
              {t('recordings.otherTab')}
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
                {otherCount}
              </span>
            </button>
          )}
        </div>
        <div className="pb-3 w-full sm:w-72">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={language === 'ko' ? "영상 제목 또는 스트리머 검색..." : "Search by video title or streamer..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Recordings List */}
      {!hasRecordingsInActiveTab ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
            <MonitorPlay className="h-10 w-10 text-muted-foreground/50" />
            {searchQuery.trim() ? (
              <p>{t('recordings.searchNoResults')}</p>
            ) : (
              <p>{t('recordings.noRecordings')}</p>
            )}
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
                    <TableHead className="pl-6 py-3">{t('recordings.broadcastInfo')}</TableHead>
                    <TableHead className="w-28 py-3">{t('recordings.fileSize')}</TableHead>
                    <TableHead className="w-48 py-3">{t('recordings.dateRecorded')}</TableHead>
                    <TableHead className="text-right pr-6 py-3 w-40">{t('recordings.actions')}</TableHead>
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
                          {(r.youtube_status || r.resolution) && (
                            <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                              {r.resolution && (
                                <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                                  {r.resolution}
                                </span>
                              )}
                              {r.is_recording && !vodProgress[r.id] && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-700 dark:text-red-300">
                                  <Video className="h-3 w-3" /> {t('recordings.recordingStatus')}
                                </span>
                              )}
                              {r.is_recording && vodProgress[r.id] && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-300">
                                  <Loader2 className="h-3 w-3 animate-spin" /> {vodProgress[r.id]}
                                </span>
                              )}
                              {r.youtube_status === 'DUPLICATE_PENDING' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                  <AlertCircle className="h-3 w-3" /> {t('recordings.youtubeWaitingDuplicate')}
                                </span>
                              )}
                              {r.youtube_status === 'UPLOADING' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-300">
                                  <Loader2 className="h-3 w-3 animate-spin" /> {t('recordings.youtubeUploading')}
                                </span>
                              )}
                              {r.youtube_status === 'UPLOADED' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-700 dark:text-green-300">
                                  <CheckCircle2 className="h-3 w-3" /> {t('recordings.youtubeUploaded')}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm font-medium">{r.size_mb} MB</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(r.created_at), 'PPP pp', { locale: language === 'ko' ? ko : enUS })}
                      </TableCell>
                      <TableCell className="text-right pr-6 py-4 flex justify-end gap-2">
                        {!r.is_recording && r.youtube_status !== 'UPLOADING' && r.youtube_status !== 'UPLOADED' && (
                          <Button variant="outline" size="sm" onClick={() => handleYoutubeUploadClick(r.id || '', r.filename)} className="h-8 w-8 p-0 bg-transparent hover:bg-primary/10 border-border/50 hover:border-primary/50 transition-colors" title={t('recordings.uploadToYoutube')}>
                            <Upload className="h-5 w-5 text-foreground" />
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => handleDelete(r.filename)} className="h-8 w-8 p-0 bg-transparent hover:bg-red-500/10 border-border/50 hover:border-red-500/50 transition-colors" title={t('common.delete')}>
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
        <DialogContent className="w-[95vw] max-w-4xl p-3 sm:p-6 gap-3 sm:gap-4">
          <DialogHeader className="pb-2 border-b border-border/50">
            <DialogTitle className="text-base sm:text-lg font-bold pr-6 line-clamp-1 flex items-center gap-2 text-foreground">
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
        <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
          <form onSubmit={submitYoutubeUpload}>
            <DialogHeader>
              <DialogTitle>{t('recordings.youtubeModalTitle')}</DialogTitle>
              <DialogDescription>
                {t('recordings.youtubeModalDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="yt-title">{t('recordings.videoTitle')}</Label>
                <Input
                  id="yt-title"
                  value={uploadConfig?.title || ''}
                  onChange={(e) => setUploadConfig(prev => prev ? { ...prev, title: e.target.value } : null)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yt-desc">{t('recordings.description')}</Label>
                <textarea
                  id="yt-desc"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={uploadConfig?.description || ''}
                  onChange={(e) => setUploadConfig(prev => prev ? { ...prev, description: e.target.value } : null)}
                />
              </div>
            </div>
            <DialogFooter className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setUploadConfig(null)} disabled={isUploading}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isUploading}>
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('recordings.requestingUpload')}
                  </>
                ) : (
                  t('recordings.uploadBtn')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
