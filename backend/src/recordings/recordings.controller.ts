import { Controller, Get, Post, Param, UseGuards, Req, Res, Body, Delete } from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import * as path from 'path';

@Controller('recordings')
@UseGuards(JwtAuthGuard)
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  @Get()
  async getRecordings(@Req() req: any) {
    return this.recordingsService.getRecordings(req.user);
  }

  @Post('delete')
  async deleteRecording(@Req() req: any, @Body() body: any) {
    return this.recordingsService.deleteRecording(body.filename, req.user);
  }

  // To serve files, it is usually better to use express.static or Res().sendFile
  // For security, only serve if authorized.
  @Get('download/*')
  serveRecording(@Req() req: any, @Res() res: any) {
    const filename = req.params[0];
    const normalized = path.normalize(filename).replace(/\\/g, '/');
    if (normalized.startsWith('../') || normalized.startsWith('/')) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (!req.user.is_admin && !normalized.startsWith(`${req.user.username}/`)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const filepath = path.join(process.cwd(), '..', 'downloads', filename);
    return res.sendFile(filepath);
  }
}
