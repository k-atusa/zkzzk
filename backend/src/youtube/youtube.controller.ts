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
    const path = require('path');
    const absolutePath = path.join(process.cwd(), '..', 'downloads', body.filePath);
    // Start upload in background
    this.youtubeService.uploadVideo(
      body.recordingId || null,
      absolutePath,
      body.title,
      body.description,
      '20',
      [],
      req.user.id
    ).catch(console.error);
    return { success: true, message: 'Upload started' };
  }
}
