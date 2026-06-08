import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { parseStringPromise } from 'xml2js';

@Injectable()
export class VodService {
  private readonly logger = new Logger(VodService.name);

  constructor(private prisma: PrismaService) {}

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

        const resolutions = Object.entries(streamUrls).map(([res, info]: any) => ({
          resolution: res,
          width: info.width,
          height: info.height,
          bandwidth: info.bandwidth,
          quality: info.quality,
          download_url: info.download_url,
          download_type: info.download_type,
          estimated_size_mb: info.bandwidth ? Number(((info.bandwidth * 3600 / 8) / 1024 / 1024).toFixed(1)) : 0
        }));

        const defaultResolution = Object.keys(streamUrls)[0];

        return {
          video_info: { ...vodInfo, live_rewind_playback_json: undefined },
          resolutions,
          default_resolution: defaultResolution
        };
      }
      throw new BadRequestException('인증 실패 혹은 정보 부족');
    } catch (e) {
      this.logger.error('Error fetching VOD info:', e);
      throw new BadRequestException('VOD 정보 가져오기 중 오류가 발생했습니다.');
    }
  }

  private async getVodStreamUrls(videoId: string, inKey: string, liveRewindPlaybackJson: any) {
    if (!inKey && liveRewindPlaybackJson) {
      try {
        const playbackJson = typeof liveRewindPlaybackJson === 'string' ? JSON.parse(liveRewindPlaybackJson) : liveRewindPlaybackJson;
        const media = playbackJson.media || [];
        if (!media.length) return null;

        const masterM3u8Url = media[0].path;
        const streamUrls: any = {};
        streamUrls['1080p'] = { download_url: masterM3u8Url, width: 1920, height: 1080, bandwidth: 0, quality: '1080p', download_type: 'm3u8' };
        return streamUrls;
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
                const resolution = `${width}x${height}`;
                const quality = parseInt(height) >= 1080 ? '1080p' : parseInt(height) >= 720 ? '720p' : '480p';
                const manifestUrl = `https://apis.naver.com/neonplayer/vodplay/v2/playback/${videoId}?key=${inKey}&quality=${quality}`;
                streamUrls[resolution] = {
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
    const { download_url, video_info, resolution } = body;
    const downloadType = resolution?.download_type || 'direct';

    if (!download_url) throw new BadRequestException('다운로드 URL이 필요합니다.');

    const streamerNickname = (video_info?.author || 'Unknown').replace(/[<>:"/\\|?*]/g, '').trim();
    let datePrefix = new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14);
    if (video_info?.raw_publish_date) {
      datePrefix = new Date(video_info.raw_publish_date).toISOString().replace(/[-:T]/g, '').slice(2, 14);
    }
    const cleanTitle = (video_info?.title || 'Unknown').replace(/[<>:"/\\|?*]/g, '').trim();
    const filename = `${datePrefix} ${cleanTitle} [${streamerNickname}].mp4`;

    const vodDir = path.join(process.cwd(), '..', 'downloads', user.username, 'vod', streamerNickname);
    if (!fs.existsSync(vodDir)) fs.mkdirSync(vodDir, { recursive: true });

    const filepath = path.join(vodDir, filename);
    if (fs.existsSync(filepath)) throw new BadRequestException('이미 동일한 파일이 존재합니다.');

    // Background download using streamlink
    const child = spawn('streamlink', [
      '--http-header', 'User-Agent=Mozilla/5.0',
      download_url,
      'best',
      '--output', filepath.replace('.mp4', '.ts')
    ]);

    child.on('error', (err) => {
      this.logger.error(`Failed to start streamlink for VOD: ${err.message}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        const ffmpeg = spawn('ffmpeg', [
          '-i', filepath.replace('.mp4', '.ts'),
          '-c', 'copy',
          '-y',
          filepath
        ]);

        ffmpeg.on('error', (err) => {
          this.logger.error(`Failed to start ffmpeg for VOD: ${err.message}`);
        });

        ffmpeg.on('close', () => {
          if (fs.existsSync(filepath.replace('.mp4', '.ts'))) {
            fs.unlinkSync(filepath.replace('.mp4', '.ts'));
          }
        });
      }
    });

    return { status: 'success', message: '서버 다운로드가 시작되었습니다.', filename };
  }
}
