import { Controller, Get, Post, Param, UseGuards, Req, Res, Body, Delete } from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import * as path from 'path';

@Controller('recordings')
@UseGuards(JwtAuthGuard)
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) { }

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
    let filename = req.params[0] || req.params['0'];

    if (!filename) {
      // Try extracting from req.path
      const pathParts = req.path.split('/download/');
      if (pathParts.length > 1) {
        filename = pathParts.slice(1).join('/download/');
      } else {
        // Fallback to originalUrl just in case
        const origParts = req.originalUrl.split('?')[0].split('/download/');
        if (origParts.length > 1) {
          filename = origParts.slice(1).join('/download/');
        }
      }
    }

    if (filename) {
      try {
        filename = decodeURIComponent(filename);
      } catch (e) {
        // fallback to original if decode fails
      }
    }

    if (!filename) {
      return res.status(400).json({
        message: 'Filename is required',
        debug: {
          originalUrl: req.originalUrl,
          path: req.path,
          url: req.url,
          params: req.params
        }
      });
    }

    const normalized = path.normalize(filename).replace(/\\/g, '/');
    if (normalized.startsWith('../') || normalized.startsWith('/')) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (!req.user.is_admin && !normalized.startsWith(`${req.user.username}/`)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const filepath = path.join(process.cwd(), '..', 'downloads', filename);
    const fs = require('fs');
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ message: 'File not found', filepath });
    }

    return res.sendFile(filepath);
  }
}
