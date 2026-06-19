import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { parseStringPromise } from 'xml2js';
import { EventsService } from '../events/events.service';

@Injectable()
export class VodService {
  private readonly logger = new Logger(VodService.name);

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService
  ) {}

  async getVodInfo(vodUrl: string, user: any) {
    const match = vodUrl.match(/https?:\/\/chzzk\.naver\.com\/video\/(\d+)/);
    if (!match) throw new BadRequestException('올바른 치지직 VOD URL이 아닙니다.');
    const videoNo = match[1];

    try {
      const apiUrl = `https://api.chzzk.naver.com/service/v2/videos/${videoNo}`;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
      };

      let response = await axios.get(apiUrl, { headers, validateStatus: () => true });
      if (response.status === 404) throw new BadRequestException('VOD 정보를 가져올 수 없습니다.');

      let content = response.data?.content || {};
      let videoId = content.videoId;
      let inKey = content.inKey;
      let liveRewindPlaybackJson = content.liveRewindPlaybackJson;

      if (content.videoType === 'UPLOAD') {
        throw new BadRequestException('직접 업로드된 영상 다운로드 기능은 준비중입니다.');
      }

      if (!videoId || (!inKey && !liveRewindPlaybackJson)) {
        const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
        if (dbUser && dbUser.nid_aut && dbUser.nid_ses) {
          response = await axios.get(apiUrl, {
            headers: {
              ...headers,
              Cookie: `NID_AUT=${dbUser.nid_aut}; NID_SES=${dbUser.nid_ses}`
            }
          });
          content = response.data?.content || {};
          videoId = content.videoId;
          inKey = content.inKey;
          liveRewindPlaybackJson = content.liveRewindPlaybackJson;
        }
      }

      if (videoId && (inKey || liveRewindPlaybackJson)) {
        const vodInfo = {
          video_id: videoId,
          in_key: inKey,
          title: content.videoTitle,
          author: content.channel?.channelName,
          category: content.videoCategory,
          tags: content.tags || [],
          raw_publish_date: content.publishDate,
          live_rewind_playback_json: liveRewindPlaybackJson
        };

        const streamUrls = await this.getVodStreamUrls(videoId, inKey, liveRewindPlaybackJson);
        if (!streamUrls) throw new BadRequestException('스트림 URL을 가져올 수 없습니다.');

        let resolutions = Object.entries(streamUrls).map(([res, info]: any) => ({
          resolution: res,
          width: info.width,
          height: info.height,
          bandwidth: info.bandwidth,
          quality: info.quality,
          download_url: info.download_url,
          download_type: info.download_type,
          estimated_size_mb: info.bandwidth ? Number(((info.bandwidth * 3600 / 8) / 1024 / 1024).toFixed(1)) : 0
        }));

        resolutions.sort((a, b) => b.height - a.height);

        const defaultResolution = resolutions.length > 0 ? resolutions[0].resolution : '1080p';

        return {
          video_info: { ...vodInfo, live_rewind_playback_json: undefined },
          resolutions,
          default_resolution: defaultResolution
        };
      }
      throw new BadRequestException('인증 실패 혹은 정보 부족');
    } catch (e: any) {
      this.logger.error('Error fetching VOD info:', e);
      if (e instanceof BadRequestException) {
        throw e;
      }
      throw new BadRequestException('VOD 정보 가져오기 중 오류가 발생했습니다.');
    }
  }

  private async getVodStreamUrls(videoId: string, inKey: string, liveRewindPlaybackJson: any) {
    if (!inKey && liveRewindPlaybackJson) {
      try {
        const playbackJson = typeof liveRewindPlaybackJson === 'string' ? JSON.parse(liveRewindPlaybackJson) : liveRewindPlaybackJson;
        const media = playbackJson.media || [];
        if (!media.length) return null;

        const streamUrls: any = {};
        for (const m of media) {
          if (m.encodingTrack && Array.isArray(m.encodingTrack)) {
            for (const track of m.encodingTrack) {
              const quality = track.encodingTrackId || `${track.videoHeight}p`;
              streamUrls[quality] = {
                download_url: track.path || m.path,
                width: track.videoWidth || 0,
                height: track.videoHeight || 0,
                bandwidth: track.videoBitRate || 0,
                quality: quality,
                download_type: m.protocol === 'HLS' ? 'm3u8' : 'dash'
              };
            }
          } else {
            streamUrls['1080p'] = { download_url: m.path, width: 1920, height: 1080, bandwidth: 0, quality: '1080p', download_type: 'm3u8' };
          }
        }
        if (Object.keys(streamUrls).length > 0) return streamUrls;
      } catch (e) { return null; }
    }

    if (!inKey) return null;

    const vodUrl = `https://apis.naver.com/neonplayer/vodplay/v2/playback/${videoId}?key=${inKey}`;
    try {
      const response = await axios.get(vodUrl, {
        headers: {
          'Accept': 'application/dash+xml',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      
      const streamUrls: any = {};
      try {
        const result = await parseStringPromise(response.data);
        const adaptationSets = result.MPD?.Period?.[0]?.AdaptationSet || [];
        for (const set of adaptationSets) {
          if (set.$.mimeType?.startsWith('video')) {
            const representations = set.Representation || [];
            for (const rep of representations) {
              const width = rep.$.width;
              const height = rep.$.height;
              const bandwidth = rep.$.bandwidth;
              const baseUrl = rep.BaseURL?.[0];
              if (width && height && baseUrl && baseUrl.includes('pstatic.net')) {
                const quality = `${height}p`;
                const manifestUrl = `https://apis.naver.com/neonplayer/vodplay/v2/playback/${videoId}?key=${inKey}&quality=${quality}`;
                streamUrls[quality] = {
                  download_url: manifestUrl,
                  width: parseInt(width),
                  height: parseInt(height),
                  bandwidth: parseInt(bandwidth) || 0,
                  quality,
                  download_type: 'dash'
                };
              }
            }
          }
        }
      } catch (e) {
        // Fallback or JSON handling can be added here
      }
      return streamUrls;
    } catch (e) {
      return null;
    }
  }

  async downloadVod(body: any, user: any) {
    const { download_url, video_info, resolution, overwrite } = body;
    const downloadType = resolution?.download_type || 'direct';

    if (!download_url) throw new BadRequestException('다운로드 URL이 필요합니다.');

    const streamerNickname = (video_info?.author || 'Unknown').replace(/[<>:"/\\|?*]/g, '').trim();
    const formatDate = (dateStr?: string) => {
      const d = dateStr ? new Date(dateStr) : new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    };
    const datePrefix = formatDate(video_info?.raw_publish_date);
    const cleanTitle = (video_info?.title || 'Unknown').replace(/[<>:"/\\|?*]/g, '').trim();
    const filename = `${datePrefix} ${cleanTitle} [${streamerNickname}].mp4`;

    const vodDir = path.join(process.cwd(), '..', 'downloads', user.username, 'vod', streamerNickname);
    if (!fs.existsSync(vodDir)) fs.mkdirSync(vodDir, { recursive: true });

    const filepath = path.join(vodDir, filename);
    if (fs.existsSync(filepath)) {
      if (!overwrite) {
        throw new BadRequestException('FILE_EXISTS');
      } else {
        fs.unlinkSync(filepath);
        if (fs.existsSync(filepath.replace('.mp4', '.ts'))) {
          fs.unlinkSync(filepath.replace('.mp4', '.ts'));
        }
      }
    }

    let streamlinkCmd = 'streamlink';
    if (fs.existsSync('/opt/homebrew/bin/streamlink')) {
      streamlinkCmd = '/opt/homebrew/bin/streamlink';
    } else if (fs.existsSync('/usr/local/bin/streamlink')) {
      streamlinkCmd = '/usr/local/bin/streamlink';
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    let formatString = '1080p60,1080p,best';
    if (dbUser?.vod_resolution) {
      if (dbUser.vod_resolution === '144p') formatString = '144p,worst';
      else if (dbUser.vod_resolution === '360p') formatString = '360p,worst';
      else if (dbUser.vod_resolution === '720p') formatString = '720p60,720p,best';
      else if (dbUser.vod_resolution === '1080p') formatString = '1080p60,1080p,best';
    }

    const dbFilename = path.join('vod', streamerNickname, filename.replace('.mp4', '.ts')).replace(/\\/g, '/');
    const recording = await this.prisma.recording.create({
      data: {
        user_id: user.id,
        filename: dbFilename,
        title: cleanTitle,
        is_recording: true,
        created_at: new Date()
      }
    });

    // Background download using streamlink
    const child = spawn(streamlinkCmd, [
      '--http-header', 'User-Agent=Mozilla/5.0',
      download_url,
      formatString,
      '--output', filepath.replace('.mp4', '.ts')
    ]);

    let resolutionCaptured = false;
    const parseStreamlinkOutput = async (text: string) => {
      // streamlink 진행률 파싱 예: [download] Written 123 MB (10s @ 1.2 MB/s)
      const dlMatch = text.match(/\[download\]\s+(Written.+)/i);
      if (dlMatch) {
        this.eventsService.emitVodProgress({ recordingId: recording.id, progress: `다운로드 중: ${dlMatch[1]}` });
      }

      if (resolutionCaptured) return;
      const match = text.match(/Opening stream:\s*([a-zA-Z0-9_]+)/i);
      if (match && match[1]) {
        resolutionCaptured = true;
        let resStr = match[1];
        const dimMatch = resStr.match(/^(\d+)[xX](\d+)$/);
        if (dimMatch) {
          const minDim = Math.min(parseInt(dimMatch[1], 10), parseInt(dimMatch[2], 10));
          resStr = `${minDim}p`;
        } else {
          const numMatch = resStr.match(/^(\d+)p?(60|30)?$/i);
          if (numMatch) {
            let num = parseInt(numMatch[1], 10);
            if (num === 1920) num = 1080;
            else if (num === 1280) num = 720;
            resStr = `${num}p`;
          }
        }
        try {
          await this.prisma.recording.update({
            where: { id: recording.id },
            data: { resolution: resStr }
          });
        } catch (e) {}
      }
    };

    child.stdout.on('data', (data) => parseStreamlinkOutput(data.toString()));
    child.stderr.on('data', (data) => parseStreamlinkOutput(data.toString()));

    child.on('error', (err) => {
      this.logger.error(`Failed to start download process for VOD: ${err.message}`);
      this.eventsService.emitVodProgress({ recordingId: recording.id, progress: '다운로드 실패' });
    });

    child.on('close', async (code) => {
      if (code === 0) {
        // 기존 streamlink 다운로드 후 ffmpeg 변환 로직
        let ffmpegCmd = 'ffmpeg';
        if (fs.existsSync('/opt/homebrew/bin/ffmpeg')) {
          ffmpegCmd = '/opt/homebrew/bin/ffmpeg';
        } else if (fs.existsSync('/usr/local/bin/ffmpeg')) {
          ffmpegCmd = '/usr/local/bin/ffmpeg';
        }

        const ffmpeg = spawn(ffmpegCmd, [
          '-i', filepath.replace('.mp4', '.ts'),
          '-c', 'copy',
          '-y',
          filepath
        ]);

        this.eventsService.emitVodProgress({ recordingId: recording.id, progress: 'MP4 포맷으로 변환 중...' });

        ffmpeg.on('error', (err) => {
          this.logger.error(`Failed to start ffmpeg for VOD: ${err.message}`);
          this.eventsService.emitVodProgress({ recordingId: recording.id, progress: '변환 실패' });
        });

        ffmpeg.on('close', async (ffCode) => {
          if (fs.existsSync(filepath.replace('.mp4', '.ts'))) {
            fs.unlinkSync(filepath.replace('.mp4', '.ts'));
          }
          if (ffCode === 0) {
            try {
              await this.prisma.recording.update({
                where: { id: recording.id },
                data: { 
                  filename: path.join('vod', streamerNickname, filename).replace(/\\/g, '/'),
                  is_recording: false
                }
              });
              this.eventsService.emitVodProgress({ recordingId: recording.id, progress: '완료' });
            } catch(e) {}
          } else {
            this.logger.error(`ffmpeg exited with code ${ffCode}`);
            this.eventsService.emitVodProgress({ recordingId: recording.id, progress: '변환 실패' });
            this.prisma.recording.update({ where: { id: recording.id }, data: { is_recording: false } }).catch(() => {});
          }
        });
      } else {
        // 비정상 종료 (에러)
        this.logger.error(`Download process exited with code ${code}`);
        this.eventsService.emitVodProgress({ recordingId: recording.id, progress: '다운로드 실패 (오류 발생)' });
        this.prisma.recording.update({
          where: { id: recording.id },
          data: { is_recording: false }
        }).catch(() => {});
      }
    });

    return { status: 'success', message: '서버 다운로드가 시작되었습니다.', filename };
  }
}
