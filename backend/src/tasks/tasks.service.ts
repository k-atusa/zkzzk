import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { extractChannelId } from '../utils/chzzk.utils';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { YoutubeService } from '../youtube/youtube.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private youtubeService: YoutubeService
  ) { }

  private async sendDiscordWebhook(userId: string, embed: any) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.discord_webhook_url) {
        if (user.discord_webhook_use_embed !== false) {
          await axios.post(user.discord_webhook_url, {
            embeds: [embed],
          }).catch(() => {});
        } else {
          const textContent = `**${embed.title || '알림'}**\n${embed.description || ''}`;
          await axios.post(user.discord_webhook_url, {
            content: textContent,
          }).catch(() => {});
        }
      }
    } catch (e) {
      // Ignore webhook errors
    }
  }

  @Cron('*/30 * * * * *')
  async handleCron() {
    try {
      const streamers = await this.prisma.streamer.findMany({ where: { is_active: true } });
      for (const streamer of streamers) {
        await this.checkStreamer(streamer);
      }
    } catch (error) {
      this.logger.error('Error in handleCron', error);
    }
  }

  async checkStreamer(streamer: any) {
    const channelId = extractChannelId(streamer.channel_url);
    if (!channelId) return;

    try {
      const cookieUserId = streamer.cookie_user_id || streamer.user_id;
      const cookieUser = await this.prisma.user.findUnique({ where: { id: cookieUserId } });
      if (!cookieUser || !cookieUser.nid_aut || !cookieUser.nid_ses) return;

      const url = `https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        }
      });

      if (response.data?.code === 200 && response.data?.content) {
        const isLive = response.data.content.status === 'OPEN';
        const broadcastTitle = response.data.content.liveTitle;
        const liveCategoryValue = response.data.content.liveCategoryValue;
        const tags = response.data.content.tags || [];

        if (isLive) {
          await this.prisma.streamer.updateMany({
            where: { id: streamer.id },
            data: {
              last_checked: new Date(),
              last_live: new Date(),
              current_broadcast_title: broadcastTitle,
              current_broadcast_category: liveCategoryValue || null,
              current_broadcast_tags: tags ? JSON.stringify(tags) : null
            }
          });

          if (!streamer.is_recording && !streamer.is_paused) {
            this.downloadStream(channelId, broadcastTitle, streamer.nickname, streamer.id, liveCategoryValue, tags);
          }
        } else {
          await this.prisma.streamer.updateMany({
            where: { id: streamer.id },
            data: {
              last_checked: new Date(),
              is_recording: false,
              current_broadcast_title: null,
              current_broadcast_category: null,
              current_broadcast_tags: null
            }
          });
        }
      }
    } catch (e) {
      this.logger.error(`Error checking streamer ${streamer.nickname}:`, e instanceof Error ? e.message : String(e));
    }
  }

  async downloadStream(channelId: string, broadcastTitle: string, streamerNickname: string, streamerId: string, liveCategoryValue?: string, tags?: string[]) {
    try {
      const streamer = await this.prisma.streamer.findUnique({ where: { id: streamerId } });
      if (!streamer || !streamer.user_id) return;

      const owner = await this.prisma.user.findUnique({ where: { id: streamer.user_id } });
      if (!owner || !owner.username) return;

      const userDownloadsDir = path.join(process.cwd(), '..', 'downloads', owner.username);
      if (!fs.existsSync(userDownloadsDir)) fs.mkdirSync(userDownloadsDir, { recursive: true });

      const streamerDir = path.join(userDownloadsDir, 'live', streamerNickname);
      if (!fs.existsSync(streamerDir)) fs.mkdirSync(streamerDir, { recursive: true });

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      let filename = `${dateStr} ${broadcastTitle} [${streamerNickname}].ts`;
      filename = filename.replace(/[<>:"/\\|?*]/g, '');
      const filepath = path.join(streamerDir, filename);

      const cookieUserId = streamer.cookie_user_id || streamer.user_id;
      if (!cookieUserId) return;
      const cookieUser = await this.prisma.user.findUnique({ where: { id: cookieUserId } });

      const streamUrl = `https://chzzk.naver.com/live/${channelId}`;
      let command = 'streamlink';
      if (fs.existsSync('/opt/homebrew/bin/streamlink')) {
        command = '/opt/homebrew/bin/streamlink';
      } else if (fs.existsSync('/usr/local/bin/streamlink')) {
        command = '/usr/local/bin/streamlink';
      }

      let formatString = '1080p60,1080p,best';
      if (cookieUser?.live_resolution) {
        if (cookieUser.live_resolution === '144p') formatString = '144p,worst';
        else if (cookieUser.live_resolution === '360p') formatString = '360p,worst';
        else if (cookieUser.live_resolution === '720p') formatString = '720p60,720p,best';
        else if (cookieUser.live_resolution === '1080p') formatString = '1080p60,1080p,best';
      }

      const args = [
        '--ffmpeg-copyts',
        '--progress', 'no',
        '--http-cookie', `NID_AUT=${cookieUser?.nid_aut}`,
        '--http-cookie', `NID_SES=${cookieUser?.nid_ses}`,
        streamUrl,
        formatString,
        '--output', filepath
      ];

      const recording = await this.prisma.recording.create({
        data: {
          streamer_id: streamerId,
          user_id: streamer.user_id,
          filename: path.join('live', streamerNickname, filename).replace(/\\/g, '/'),
          title: broadcastTitle,
          is_recording: true,
          created_at: new Date()
        }
      });

      const child = spawn(command, args);

      let resolutionCaptured = false;
      const parseResolution = async (text: string) => {
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

      child.stdout.on('data', (data) => {
        const text = data.toString();
        this.logger.log(`[Streamlink stdout] ${text.trim()}`);
        parseResolution(text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        this.logger.error(`[Streamlink stderr] ${text.trim()}`);
        parseResolution(text);
      });

      child.on('error', async (err) => {
        this.logger.error(`Failed to start streamlink: ${err.message}`);
        try {
          await this.prisma.streamer.updateMany({
            where: { id: streamerId },
            data: {
              is_recording: false,
              process_id: null
            }
          });
        } catch (dbErr: any) {
          this.logger.error(`Database update failed on streamlink spawn error: ${dbErr.message}`);
        }
      });

      await this.prisma.streamer.updateMany({
        where: { id: streamerId },
        data: {
          is_recording: true,
          current_broadcast_title: broadcastTitle,
          current_broadcast_category: liveCategoryValue || null,
          current_broadcast_tags: tags ? JSON.stringify(tags) : null,
          process_id: child.pid
        }
      });

      this.sendDiscordWebhook(streamer.user_id!, {
        title: `✅ 녹화 시작`,
        description: `**${streamerNickname}**님의 녹화가 시작되었습니다.\n\n**방송 제목:** ${broadcastTitle}\n**채널 링크:** https://chzzk.naver.com/${channelId}`,
        color: 0x00FFA3, // Neon Green
        timestamp: new Date().toISOString()
      });

      child.on('close', async (code) => {
        this.logger.log(`Streamlink exited with code ${code}`);
        // Reset streamer recording status
        try {
          await this.prisma.streamer.updateMany({
            where: { id: streamerId },
            data: {
              is_recording: false,
              process_id: null
            }
          });
          this.sendDiscordWebhook(streamer.user_id!, {
            title: `🛑 녹화 종료`,
            description: `**${streamerNickname}**님의 녹화가 성공적으로 종료되었습니다.`,
            color: 0xFF4D4D, // Red
            timestamp: new Date().toISOString()
          });
        } catch (dbErr: any) {
          this.logger.error(`Database update failed on streamlink close: ${dbErr.message}`);
        }

        const mp4Filename = filename.replace('.ts', '.mp4');
        const mp4Filepath = path.join(streamerDir, mp4Filename);

        let ffmpegCmd = 'ffmpeg';
        if (fs.existsSync('/opt/homebrew/bin/ffmpeg')) {
          ffmpegCmd = '/opt/homebrew/bin/ffmpeg';
        } else if (fs.existsSync('/usr/local/bin/ffmpeg')) {
          ffmpegCmd = '/usr/local/bin/ffmpeg';
        }

        const ffmpegChild = spawn(ffmpegCmd, [
          '-err_detect', 'ignore_err',
          '-i', filepath,
          '-c', 'copy',
          '-start_at_zero',
          '-y',
          mp4Filepath
        ]);

        ffmpegChild.on('error', (err) => {
          this.logger.error(`Failed to start ffmpeg: ${err.message}`);
        });

        ffmpegChild.on('close', async (ffmpegCode) => {
          if (ffmpegCode === 0) {
            if (fs.existsSync(filepath)) {
              fs.unlinkSync(filepath);
            }
            try {
              await this.prisma.recording.updateMany({
                where: { id: recording.id },
                data: { 
                  filename: path.join('live', streamerNickname, mp4Filename).replace(/\\/g, '/'),
                  is_recording: false
                }
              });

              this.sendDiscordWebhook(streamer.user_id!, {
                title: `💽 MP4 변환 완료`,
                description: `**${streamerNickname}**님의 영상이 MP4로 성공적으로 변환되었습니다.\n\n**방송 제목:** ${broadcastTitle}`,
                color: 0x3498DB, // Blue
                timestamp: new Date().toISOString()
              });

              // Trigger YouTube upload
              try {
                const user = await this.prisma.user.findUnique({ where: { id: streamer.user_id! } });
                if (user?.youtube_client_id && user?.youtube_client_secret && user?.youtube_refresh_token && user?.youtube_auto_upload !== false) {
                  if (this.youtubeService.acquireLock(mp4Filepath)) {
                    try {
                      const { isDuplicate, fileHash } = await this.youtubeService.checkDuplicateVideo(user.id, mp4Filename, mp4Filepath);
                      if (isDuplicate) {
                        this.youtubeService.releaseLock(mp4Filepath);
                        await this.prisma.recording.updateMany({
                          where: { id: recording.id },
                          data: { youtube_status: 'DUPLICATE_PENDING' }
                        });
                        this.sendDiscordWebhook(user.id, {
                          title: `⚠️ 유튜브 업로드 대기 (중복)`,
                          description: `**${streamerNickname}**님의 영상과 동일한 제목의 영상이 이미 유튜브에 존재합니다.\n\n**파일명:** ${mp4Filename}\n\n웹 서비스에 접속하여 직접 업로드 여부를 결정해주세요.`,
                          color: 0xF39C12, // Orange/Yellow
                          timestamp: new Date().toISOString()
                        });
                      } else {
                        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
                        const description = `Automatically uploaded via ZKZZK version ${pkg.version}`;
                        this.youtubeService.uploadVideo(recording.id, mp4Filepath, mp4Filename, description, liveCategoryValue || '20', tags, user.id, fileHash).catch(e => {
                          this.logger.error(`YouTube upload failed: ${e.message}`);
                        });
                      }
                    } catch (err) {
                      this.youtubeService.releaseLock(mp4Filepath);
                    }
                  } else {
                    this.logger.warn(`Auto-upload skipped for ${mp4Filename} because it's already locked by another process.`);
                  }
                }
              } catch (ytErr: any) {
                this.logger.error(`Failed to handle YouTube auto-upload: ${ytErr.message}`);
              }
            } catch (dbErr: any) {
              this.logger.error(`Failed to update recording filename: ${dbErr.message}`);
            }
          } else {
            this.logger.error(`ffmpeg exited with non-zero code: ${ffmpegCode}`);
            try {
              await this.prisma.recording.updateMany({
                where: { id: recording.id },
                data: { is_recording: false } // Keep .ts filename if conversion failed
              });
            } catch (dbErr: any) {
              this.logger.error(`Failed to reset recording state after ffmpeg error: ${dbErr.message}`);
            }
          }
        });
      });
    } catch (e) {
      this.logger.error('Error starting download stream:', e instanceof Error ? e.message : String(e));
    }
  }
}
