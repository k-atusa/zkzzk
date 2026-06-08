import { Controller, Post, Body, Get, Param, UseGuards, Req, Delete } from '@nestjs/common';
import { StreamersService } from './streamers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('streamers')
@UseGuards(JwtAuthGuard)
export class StreamersController {
  constructor(private readonly streamersService: StreamersService) {}

  @Get()
  async getStreamers(@Req() req: any) {
    return this.streamersService.getStreamers(req.user);
  }

  @Get('following')
  async getFollowedStreamers(@Req() req: any) {
    return this.streamersService.getFollowedStreamers(req.user);
  }

  @Post('add_streamer')
  async addStreamer(@Req() req: any, @Body() body: any) {
    const streamer = await this.streamersService.addStreamer(body.channel_url, req.user);
    return { status: 'success', message: '스트리머가 추가되었습니다.', streamer };
  }

  @Post('remove_streamer/:id')
  async removeStreamer(@Param('id') id: string, @Req() req: any) {
    return this.streamersService.removeStreamer(id, req.user);
  }

  @Post('stop_recording/:id')
  async stopRecording(@Param('id') id: string, @Req() req: any) {
    return this.streamersService.stopRecording(id, req.user);
  }

  @Post('set_streamer_cookies')
  async setStreamerCookies(@Req() req: any, @Body() body: any) {
    return this.streamersService.setStreamerCookies(body.streamer_id, body.cookie_user_id, req.user);
  }
}
