import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  constructor(private prisma: PrismaService) {}

  private async sendDiscordWebhook(embed: any) {
    try {
      const settings = await this.prisma.settings.findFirst();
      if (settings?.discord_webhook_url) {
        await axios.post(settings.discord_webhook_url, {
          embeds: [embed],
        }).catch(() => {});
      }
    } catch (e) {
      // Ignore webhook errors
    }
  }

  private async getAuthClient() {
    const settings = await this.prisma.settings.findFirst();
    if (!settings?.youtube_client_id || !settings?.youtube_client_secret) {
      throw new Error('YouTube API is not configured');
    }

    const oauth2Client = new google.auth.OAuth2(
      settings.youtube_client_id,
      settings.youtube_client_secret,
      'http://localhost:5001/api/youtube/callback'
    );

    if (settings.youtube_refresh_token) {
      oauth2Client.setCredentials({
        refresh_token: settings.youtube_refresh_token,
      });
    }

    return oauth2Client;
  }

  async getAuthUrl() {
    const oauth2Client = await this.getAuthClient();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly'
      ],
      prompt: 'consent', // Force to get refresh token
    });
    return url;
  }

  async setCredentials(code: string): Promise<string | null> {
    const oauth2Client = await this.getAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    
    oauth2Client.setCredentials(tokens);

    if (tokens.refresh_token) {
      await this.prisma.settings.updateMany({
        data: { youtube_refresh_token: tokens.refresh_token }
      });
    } else {
      // In case Google OAuth doesn't return a refresh_token (already consented),
      // we still check if we have an existing one. If not, we still proceed to get the channel name.
      const settings = await this.prisma.settings.findFirst();
      if (!settings?.youtube_refresh_token) {
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

  async checkDuplicateVideo(title: string): Promise<boolean> {
    try {
      const auth = await this.getAuthClient();
      const youtube = google.youtube({ version: 'v3', auth });

      const response = await youtube.search.list({
        part: ['snippet'],
        forMine: true,
        type: ['video'],
        q: title,
        maxResults: 10,
      });

      const items = response.data.items || [];
      // Exact title match check
      for (const item of items) {
        if (item.snippet?.title === title) {
          return true;
        }
      }
      return false;
    } catch (e: any) {
      this.logger.error(`Failed to check duplicate video: ${e.message}`);
      return false; // Fail open to allow upload attempts or handle accordingly
    }
  }

  async uploadVideo(recordingId: string, filePath: string, title: string, category: string = '20', tags: string[] = []): Promise<void> {
    try {
      await this.prisma.recording.updateMany({
        where: { id: recordingId },
        data: { youtube_status: 'UPLOADING' }
      });

      this.sendDiscordWebhook({
        title: `📤 유튜브 업로드 시작`,
        description: `**${title}** 영상의 유튜브 업로드를 시작합니다.`,
        color: 0x9B59B6, // Purple
        timestamp: new Date().toISOString()
      });

      const auth = await this.getAuthClient();
      const youtube = google.youtube({ version: 'v3', auth });

      const fileSize = fs.statSync(filePath).size;
      const media = {
        body: fs.createReadStream(filePath),
      };

      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description: `Auto-uploaded recording: ${title}`,
            tags: tags,
          },
          status: {
            privacyStatus: 'unlisted', // 'private', 'public', or 'unlisted'
          },
        },
        media: media,
      }, {
        onUploadProgress: evt => {
          const progress = (evt.bytesRead / fileSize) * 100;
          this.logger.log(`Uploading ${title} - ${Math.round(progress)}%`);
        },
      });

      if (res.data.id) {
        await this.prisma.recording.updateMany({
          where: { id: recordingId },
          data: { 
            youtube_status: 'UPLOADED',
            youtube_video_id: res.data.id
          }
        });
        this.logger.log(`Upload completed for ${title}`);
        this.sendDiscordWebhook({
          title: `✅ 유튜브 업로드 완료`,
          description: `**${title}** 영상이 유튜브에 성공적으로 업로드되었습니다.\n\n**비디오 링크**: [youtu.be/${res.data.id}](https://youtu.be/${res.data.id})`,
          color: 0x2ECC71, // Emerald Green
          timestamp: new Date().toISOString()
        });
      }
    } catch (e: any) {
      this.logger.error(`Upload failed for ${title}: ${e.message}`);
      await this.prisma.recording.updateMany({
        where: { id: recordingId },
        data: { youtube_status: 'FAILED' }
      });
      this.sendDiscordWebhook({
        title: `❌ 유튜브 업로드 실패`,
        description: `**${title}** 영상의 유튜브 업로드가 실패했습니다.\n\n**오류**: ${e.message}`,
        color: 0xFF0000, // Red
        timestamp: new Date().toISOString()
      });
    }
  }
}
