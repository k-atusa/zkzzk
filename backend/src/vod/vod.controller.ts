import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { VodService } from './vod.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('vod')
@UseGuards(JwtAuthGuard)
export class VodController {
  constructor(private readonly vodService: VodService) {}

  @Post('get_vod_info')
  async getVodInfo(@Req() req: any, @Body() body: { vod_url: string }) {
    return this.vodService.getVodInfo(body.vod_url, req.user);
  }

  @Post('download_vod')
  async downloadVod(@Req() req: any, @Body() body: any) {
    return this.vodService.downloadVod(body, req.user);
  }
}
