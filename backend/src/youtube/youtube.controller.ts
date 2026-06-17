import { Controller, Get, Post, Body, Query, Res, Req, UseGuards } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';

@Controller('youtube')
export class YoutubeController {
  constructor(private readonly youtubeService: YoutubeService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('auth-url')
  async getAuthUrl(@Req() req: any) {
    try {
      const url = await this.youtubeService.getAuthUrl(req.user.id);
      return { url };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    if (!code || !state) {
      return res.redirect('http://localhost:5173/settings?youtube=error');
    }

    try {
      const channelName = await this.youtubeService.setCredentials(code, state);
      if (channelName) {
        const encodedName = encodeURIComponent(channelName);
        return res.redirect(`http://localhost:5173/settings?youtube=success&channelName=${encodedName}`);
      } else {
        return res.redirect('http://localhost:5173/settings?youtube=error');
      }
    } catch (e: any) {
      return res.redirect(`http://localhost:5173/settings?youtube=error`);
    }
  }

  // Allow manual upload trigger
  @UseGuards(AuthGuard('jwt'))
  @Post('upload')
  async triggerUpload(
    @Req() req: any,
    @Body() body: { recordingId?: string; filePath: string; title: string; description?: string }
  ) {
    if (body.recordingId) {
      const recording = await this.youtubeService.getRecording(body.recordingId);
      if (recording && recording.youtube_status === 'UPLOADED' && recording.youtube_video_id) {
        return { 
          success: true, 
          already_uploaded: true, 
          video_id: recording.youtube_video_id,
          message: 'Already uploaded' 
        };
      }
    }

    const path = require('path');
    const absolutePath = path.join(process.cwd(), '..', 'downloads', body.filePath);

    try {
      if (!this.youtubeService.acquireLock(absolutePath)) {
        return { success: false, message: '이 파일에 대해 이미 다른 업로드 작업이 진행 중입니다.' };
      }
      const { isDuplicate, fileHash } = await this.youtubeService.checkDuplicateVideo(req.user.id, body.title, absolutePath);
      if (isDuplicate) {
        this.youtubeService.releaseLock(absolutePath);
        return { 
          success: true, 
          already_uploaded: true,
          video_id: '', // Not easily retrievable by search API instantly, but frontend will show toast
          message: '이미 유튜브 채널에 업로드된 영상입니다.' 
        };
      }
      
      // Start upload in background
      this.youtubeService.uploadVideo(
        body.recordingId || null,
        absolutePath,
        body.title,
        body.description,
        '20',
        [],
        req.user.id,
        fileHash
      ).catch(console.error);
      
      return { success: true, message: 'Upload started' };
    } catch (e) {
      this.youtubeService.releaseLock(absolutePath);
      return { success: false, message: '업로드 검증 중 오류 발생' };
    }
  }
}
