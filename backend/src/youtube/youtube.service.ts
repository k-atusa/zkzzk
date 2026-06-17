import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  constructor(private prisma: PrismaService) { }

  private async sendDiscordWebhook(userId: string, embed: any) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.discord_webhook_url) {
        await axios.post(user.discord_webhook_url, {
          embeds: [embed],
        }).catch(() => { });
      }
    } catch (e) {
      // Ignore webhook errors
    }
  }

  private async getAuthClient(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.youtube_client_id || !user?.youtube_client_secret) {
      throw new Error('YouTube API is not configured for this user');
    }

    const oauth2Client = new google.auth.OAuth2(
      user.youtube_client_id,
      user.youtube_client_secret,
      'http://localhost:5001/api/youtube/callback'
    );

    if (user.youtube_refresh_token) {
      oauth2Client.setCredentials({
        refresh_token: user.youtube_refresh_token,
      });
    }

    return oauth2Client;
  }

  async getAuthUrl(userId: string) {
    const oauth2Client = await this.getAuthClient(userId);
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly'
      ],
      prompt: 'consent', // Force to get refresh token
      state: userId,
    });
    return url;
  }

  async setCredentials(code: string, userId: string): Promise<string | null> {
    const oauth2Client = await this.getAuthClient(userId);
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    if (tokens.refresh_token) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { youtube_refresh_token: tokens.refresh_token }
      });
    } else {
      // In case Google OAuth doesn't return a refresh_token (already consented),
      // we still check if we have an existing one. If not, we still proceed to get the channel name.
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user?.youtube_refresh_token) {
        this.logger.warn('No refresh token received and none stored in database.');
      }
    }

    try {
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      const response = await youtube.channels.list({
        part: ['snippet'],
        mine: true,
      });
      const channelName = response.data.items?.[0]?.snippet?.title || null;
      return channelName;
    } catch (e: any) {
      this.logger.error(`Failed to fetch YouTube channel info: ${e.message}`);
      return '인증된 채널';
    }
  }

  private getFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', err => reject(err));
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async checkDuplicateVideo(userId: string, title: string, filePath?: string): Promise<boolean> {
    try {
      const auth = await this.getAuthClient(userId);
      const youtube = google.youtube({ version: 'v3', auth });

      const cleanTitle = title.replace(/\.(mp4|ts|mkv|avi)$/i, '');

      const response = await youtube.search.list({
        part: ['snippet'],
        forMine: true,
        type: ['video'],
        q: cleanTitle,
        maxResults: 10,
      });

      let fileHash: string | null = null;
      if (filePath && fs.existsSync(filePath)) {
        try {
          fileHash = await this.getFileHash(filePath);
        } catch (e: any) {
          this.logger.error(`Failed to calculate file hash: ${e.message}`);
        }
      }

      const items = response.data.items || [];
      
      for (const item of items) {
        const desc = item.snippet?.description || '';
        // 1. Hash-based check (Primary)
        if (fileHash && desc.includes(`[FileHash: ${fileHash}]`)) {
          this.logger.log(`Duplicate found by hash: ${fileHash}`);
          return true;
        }
        // 2. Title-based check (Fallback for old videos)
        if (item.snippet?.title === cleanTitle) {
          this.logger.log(`Duplicate found by title: ${cleanTitle}`);
          return true;
        }
      }
      return false;
    } catch (e: any) {
      this.logger.error(`Failed to check duplicate video: ${e.message}`);
      return false; // Fail open to allow upload attempts or handle accordingly
    }
  }

  async uploadVideo(recordingId: string | null, filePath: string, title: string, description?: string, category: string = '20', tags: string[] = [], userId?: string): Promise<void> {
    let finalUserId = userId;
    const cleanTitle = title.replace(/\.(mp4|ts|mkv|avi)$/i, '');
    try {
      if (recordingId) {
        const recording = await this.prisma.recording.findUnique({ where: { id: recordingId } });
        if (recording && recording.user_id) {
          finalUserId = recording.user_id;
        }
      }

      if (!finalUserId) throw new Error('User ID is required for YouTube upload');

      if (recordingId) {
        await this.prisma.recording.updateMany({
          where: { id: recordingId },
          data: { youtube_status: 'UPLOADING' }
        });
      }

      this.sendDiscordWebhook(finalUserId, {
        title: `📤 유튜브 업로드 시작`,
        description: `**${cleanTitle}** 영상의 유튜브 업로드를 시작합니다.`,
        color: 0x9B59B6, // Purple
        timestamp: new Date().toISOString()
      });

      const auth = await this.getAuthClient(finalUserId);
      const youtube = google.youtube({ version: 'v3', auth });

      const fileSize = fs.statSync(filePath).size;
      const media = {
        body: fs.createReadStream(filePath),
      };

      let fileHash = '';
      try {
        fileHash = await this.getFileHash(filePath);
      } catch (e: any) {
        this.logger.error(`Could not calculate hash for upload: ${e.message}`);
      }

      let finalDescription = description || '';
      if (fileHash) {
        finalDescription += `\n\n[FileHash: ${fileHash}]`;
      }

      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: cleanTitle,
            description: finalDescription,
            categoryId: category,
            tags: tags,
          },
          status: {
            privacyStatus: 'unlisted', // Or 'public' depending on requirement
          },
        },
        media: media,
      }, {
        onUploadProgress: evt => {
          const progress = (evt.bytesRead / fileSize) * 100;
          this.logger.log(`Uploading ${cleanTitle} - ${Math.round(progress)}%`);
        },
      });

      if (res.data.id) {
        if (recordingId) {
          await this.prisma.recording.updateMany({
            where: { id: recordingId },
            data: {
              youtube_status: 'UPLOADED',
              youtube_video_id: res.data.id
            }
          });
        }
        this.logger.log(`Upload completed for ${cleanTitle}`);
        this.sendDiscordWebhook(finalUserId, {
          title: `✅ 유튜브 업로드 완료`,
          description: `**${cleanTitle}** 영상이 유튜브에 성공적으로 업로드되었습니다.\n\n**비디오 링크**: [youtu.be/${res.data.id}](https://youtu.be/${res.data.id})`,
          color: 0x2ECC71, // Emerald Green
          timestamp: new Date().toISOString()
        });

        const uploadUser = await this.prisma.user.findUnique({ where: { id: finalUserId } });
        if (uploadUser?.delete_after_upload) {
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              this.logger.log(`Deleted local file after upload: ${filePath}`);
            }
            if (recordingId) {
              await this.prisma.recording.deleteMany({
                where: { id: recordingId }
              });
              this.logger.log(`Deleted recording from database: ${recordingId}`);
            }
          } catch (delErr: any) {
            this.logger.error(`Failed to delete file or record after upload: ${delErr.message}`);
          }
        }
      }
    } catch (e: any) {
      this.logger.error(`Upload failed for ${cleanTitle}: ${e.message}`);
      if (recordingId) {
        await this.prisma.recording.updateMany({
          where: { id: recordingId },
          data: { youtube_status: 'FAILED' }
        });
      }
      if (finalUserId) {
        this.sendDiscordWebhook(finalUserId, {
          title: `❌ 유튜브 업로드 실패`,
          description: `**${cleanTitle}** 영상의 유튜브 업로드가 실패했습니다.\n\n**오류**: ${e.message}`,
          color: 0xFF0000, // Red
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  async getRecording(id: string) {
    return this.prisma.recording.findUnique({ where: { id } });
  }
}
