import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { extractChannelId } from '../utils/chzzk.utils';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private prisma: PrismaService) { }

  private async sendDiscordWebhook(message: string) {
    try {
      const settings = await this.prisma.settings.findFirst();
      if (settings?.discord_webhook_url) {
        await axios.post(settings.discord_webhook_url, {
          content: message,
        }).catch(() => {});
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

      const args = [
        '--ffmpeg-copyts',
        '--progress', 'no',
        '--http-cookie', `NID_AUT=${cookieUser?.nid_aut}`,
        '--http-cookie', `NID_SES=${cookieUser?.nid_ses}`,
        streamUrl,
        '720p60,720p,best',
        '--output', filepath
      ];

      const child = spawn(command, args);

      child.stdout.on('data', (data) => {
        this.logger.log(`[Streamlink stdout] ${data.toString().trim()}`);
      });

      child.stderr.on('data', (data) => {
        this.logger.error(`[Streamlink stderr] ${data.toString().trim()}`);
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

      const recording = await this.prisma.recording.create({
        data: {
          streamer_id: streamerId,
          user_id: streamer.user_id,
          filename: path.join('live', streamerNickname, filename).replace(/\\/g, '/'),
          title: broadcastTitle,
          created_at: new Date()
        }
      });

      this.sendDiscordWebhook(`✅ **녹화 시작**: ${streamerNickname} - ${broadcastTitle}`);

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
          this.sendDiscordWebhook(`🛑 **녹화 종료**: ${streamerNickname}`);
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
                data: { filename: path.join('live', streamerNickname, mp4Filename).replace(/\\/g, '/') }
              });
            } catch (dbErr: any) {
              this.logger.error(`Failed to update recording filename: ${dbErr.message}`);
            }
          }
        });
      });
    } catch (e) {
      this.logger.error('Error starting download stream:', e instanceof Error ? e.message : String(e));
    }
  }
}
