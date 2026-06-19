import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Trash2, StopCircle, RefreshCw, Loader2, Radio, PlayCircle } from 'lucide-react';
import api from '@/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export const Live = () => {
  const [streamers, setStreamers] = useState<any[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [hasCookies, setHasCookies] = useState(false);

  // Following dropdown
  const [followedStreamers, setFollowedStreamers] = useState<any[]>([]);
  const [showFollowDropdown, setShowFollowDropdown] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followFetched, setFollowFetched] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    description: string | React.ReactNode;
    onConfirm: () => void;
    isDestructive?: boolean;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchStreamers = async () => {
    try {
      const res = await api.get('/streamers');
      setStreamers(res.data);
    } catch (e) {
      toast.error('스트리머 목록을 불러오는데 실패했습니다.');
    }
  };

  const fetchMe = async () => {
    try {
      const res = await api.get('/auth/me');
      setHasCookies(res.data.has_cookies);
    } catch (e) {}
  };

  useEffect(() => {
    fetchStreamers();
    fetchMe();
    const interval = setInterval(fetchStreamers, 2000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowFollowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputFocus = async () => {
    if (!hasCookies) return;
    setShowFollowDropdown(true);
    if (!followFetched) {
      setFollowLoading(true);
      try {
        const res = await api.get('/streamers/following');
        setFollowedStreamers(res.data);
        setFollowFetched(true);
      } catch (error: any) {
        const msg = error.response?.data?.message || '팔로우 목록을 가져오는데 실패했습니다.';
        toast.error(msg);
        setShowFollowDropdown(false);
      } finally {
        setFollowLoading(false);
      }
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasCookies) {
      toast.error('먼저 설정 메뉴에서 치지직 쿠키를 설정해주세요.');
      return;
    }
    try {
      await api.post('/streamers/add_streamer', { channel_url: newUrl });
      toast.success('스트리머가 추가되었습니다.');
      setNewUrl('');
      setShowFollowDropdown(false);
      fetchStreamers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '추가 실패');
    }
  };

  const handleAddFromFollowing = async (channel: any) => {
    setAddingId(channel.channelId);
    setShowFollowDropdown(false);
    try {
      await api.post('/streamers/add_streamer', { channel_url: channel.channel_url });
      toast.success(`${channel.channelName}이(가) 추가되었습니다.`);
      fetchStreamers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '추가 실패');
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = (streamer: any) => {
    setConfirmConfig({
      title: '스트리머 삭제',
      description: (
        <>
          정말 <strong>{streamer.nickname}</strong>님을 삭제하시겠습니까? <br />
          삭제하시면 자동 녹화 대상에서 제외됩니다.
        </>
      ),
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.post(`/streamers/remove_streamer/${streamer.id}`);
          toast.success('삭제되었습니다.');
          fetchStreamers();
        } catch (error: any) {
          toast.error(error.response?.data?.message || '삭제 실패');
        }
      }
    });
  };

  const handleStopRecording = (id: string) => {
    setConfirmConfig({
      title: '녹화 일시중지',
      description: '자동 녹화를 일시중지하시겠습니까? (현재 방송 중이면 녹화가 종료됩니다)',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await api.post(`/streamers/stop_recording/${id}`);
          toast.success('녹화가 중지되었습니다.');
          fetchStreamers();
        } catch (error: any) {
          toast.error(error.response?.data?.message || '중지 실패');
        }
      }
    });
  };

  const handleResumeRecording = async (id: string) => {
    try {
      await api.post(`/streamers/resume_recording/${id}`);
      toast.success('자동 녹화가 재개되었습니다.');
      fetchStreamers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '재개 실패');
    }
  };

  // Filter followed by current input text and sort by live status (live first)
  const filteredFollowed = followedStreamers
    .filter(ch => !newUrl || ch.channelName?.toLowerCase().includes(newUrl.toLowerCase()))
    .sort((a, b) => {
      const aLive = a.openLive ? 1 : 0;
      const bLive = b.openLive ? 1 : 0;
      return bLive - aLive; // 1 (live) comes before 0 (offline)
    });

  // Check if already added
  const addedUrls = new Set(streamers.map(s => s.channel_url));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">스트리머 관리</h2>
        <Button variant="outline" onClick={fetchStreamers}>
          <RefreshCw className="mr-2 h-4 w-4" /> 새로고침
        </Button>
      </div>

      <Card className="!overflow-visible">
        <CardHeader>
          <CardTitle>새 스트리머 추가</CardTitle>
        </CardHeader>
        <CardContent className="!overflow-visible">
          <form onSubmit={handleAdd} className="flex space-x-2">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onFocus={handleInputFocus}
                placeholder="https://chzzk.naver.com/..."
                required
                autoComplete="off"
              />

              {/* Following Dropdown */}
              {showFollowDropdown && hasCookies && (
                <div
                  ref={dropdownRef}
                  className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
                >
                  {followLoading ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      팔로우 목록 불러오는 중...
                    </div>
                  ) : filteredFollowed.length === 0 ? (
                    <div className="py-4 px-3 text-center text-sm text-muted-foreground">
                      {newUrl ? '검색 결과가 없습니다.' : '팔로우 중인 스트리머가 없습니다.'}
                    </div>
                  ) : (
                    <div className="max-h-[480px] overflow-y-auto">
                      <div className="px-3 py-2 text-xs text-muted-foreground font-medium border-b border-border bg-muted/30">
                        팔로우 중인 채널 ({filteredFollowed.length})
                      </div>
                      {filteredFollowed.map((ch) => {
                        const isAdded = addedUrls.has(ch.channel_url);
                        const isAdding = addingId === ch.channelId;
                        return (
                          <button
                            key={ch.channelId}
                            type="button"
                            disabled={isAdded || isAdding}
                            onClick={() => !isAdded && handleAddFromFollowing(ch)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                              isAdded
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-accent hover:text-accent-foreground cursor-pointer'
                            }`}
                          >
                            {ch.channelImageUrl ? (
                              <img
                                src={ch.channelImageUrl}
                                alt={ch.channelName}
                                className="h-7 w-7 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
                                {ch.channelName?.charAt(0)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <p className="text-sm font-medium truncate">{ch.channelName}</p>
                                {ch.verifiedMark && (
                                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 flex-shrink-0">
                                    <svg className="h-2 w-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  </span>
                                )}
                              </div>
                              {ch.openLive && ch.liveTitle && (
                                <p className="text-xs text-muted-foreground truncate">{ch.liveTitle}</p>
                              )}
                              {ch.openLive && (ch.liveCategoryValue || (ch.tags && ch.tags.length > 0)) && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  {ch.liveCategoryValue && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                                      {ch.liveCategoryValue}
                                    </span>
                                  )}
                                  {ch.tags && ch.tags.slice(0, 3).map((tag: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                                      #{tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {ch.openLive && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                                  <Radio className="h-3 w-3" />
                                  {(ch.concurrentUserCount ?? 0).toLocaleString()}
                                </span>
                              )}
                              {isAdding ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              ) : isAdded ? (
                                <span className="text-xs text-muted-foreground">추가됨</span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button type="submit">
              <Plus className="mr-2 h-4 w-4" /> 추가
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>등록된 스트리머</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>닉네임</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>방송 정보</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {streamers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">등록된 스트리머가 없습니다.</TableCell>
                </TableRow>
              ) : streamers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <a href={s.channel_url} target="_blank" rel="noreferrer" className="hover:underline">{s.nickname}</a>
                  </TableCell>
                  <TableCell>
                    {s.is_paused ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-yellow-500/10 text-yellow-600">
                        일시중지
                      </span>
                    ) : s.is_recording ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-red-500/10 text-red-500">
                        <span className="w-2 h-2 mr-1.5 bg-red-500 rounded-full animate-pulse"></span>
                        녹화중
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                        대기중
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md">
                    {s.current_broadcast_title ? (
                      <div className="space-y-1">
                        <div className="text-sm font-medium truncate text-foreground" title={s.current_broadcast_title}>
                          {s.current_broadcast_title}
                        </div>
                        {(s.current_broadcast_category || (s.current_broadcast_tags && s.current_broadcast_tags.length > 0)) && (
                          <div className="flex flex-wrap items-center gap-1">
                            {s.current_broadcast_category && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                                {s.current_broadcast_category}
                              </span>
                            )}
                            {s.current_broadcast_tags && s.current_broadcast_tags.slice(0, 3).map((tag: string, idx: number) => (
                              <span key={idx} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {s.is_paused ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResumeRecording(s.id)}
                        className="h-8 w-8 p-0 bg-transparent hover:bg-green-500/10 border-border/50 hover:border-green-500/50 transition-colors"
                        title="녹화 재개"
                      >
                        <PlayCircle className="h-4 w-4 text-green-500" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStopRecording(s.id)}
                        className="h-8 w-8 p-0 bg-transparent hover:bg-red-500/10 border-border/50 hover:border-red-500/50 transition-colors"
                        title="녹화 중지"
                      >
                        <StopCircle className="h-5 w-5 text-red-500" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(s)}
                      className="h-8 w-8 p-0 bg-transparent hover:bg-red-500/10 border-border/50 hover:border-red-500/50 transition-colors"
                      title="스트리머 삭제"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
