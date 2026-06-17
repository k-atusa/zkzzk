import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecordingsService {
  constructor(private prisma: PrismaService) {}

  private downloadsDir = path.join(process.cwd(), '..', 'downloads');

  private canAccessRecordingPath(filename: string, user: any): boolean {
    const normalized = path.normalize(filename).replace(/\\/g, '/');
    if (normalized.startsWith('../') || normalized.startsWith('/')) return false;
    if (!user) return false;
    if (user.is_admin) return true;
    return normalized.startsWith(`${user.username}/`);
  }

  async getRecordings(user: any) {
    const recordings: any[] = [];
    const userDownloadsDir = path.join(this.downloadsDir, user.username);

    // Fetch DB recordings to get youtube status and ID
    const dbRecordings = await this.prisma.recording.findMany(
      user.is_admin ? undefined : { where: { user_id: user.id } }
    );
    const dbRecordingMap = new Map();
    for (const rec of dbRecordings) {
      dbRecordingMap.set(rec.filename, rec);
    }

    if (fs.existsSync(userDownloadsDir)) {
      const walkSync = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filepath = path.join(dir, file);
          const stat = fs.statSync(filepath);
          if (stat.isDirectory()) {
            walkSync(filepath);
          } else if (file.endsWith('.ts') || file.endsWith('.mp4')) {
            const relPath = path.relative(this.downloadsDir, filepath).replace(/\\/g, '/');
            const relToUser = path.relative(userDownloadsDir, filepath);
            const parts = relToUser.split(path.sep);

            let streamerName = '기타';
            if (parts.length >= 3) {
              const category = parts[0];
              const streamerFolder = parts[1];
              if (category === 'live') streamerName = `${streamerFolder} (라이브)`;
              else if (category === 'vod') streamerName = `${streamerFolder} (다시보기)`;
              else streamerName = `${streamerFolder} (${category})`;
            } else if (parts.length === 2) {
              if (parts[0] === 'vod') streamerName = '다시보기 (기존)';
              else streamerName = parts[0];
            }

            const match = file.match(/^\d{6}_\d{6} (.+) \[.+\]\.(ts|mp4)$/);
            const title = match ? match[1] : file;

            const dbLookupPath = path.relative(userDownloadsDir, filepath).replace(/\\/g, '/');
            const dbRec = dbRecordingMap.get(dbLookupPath);

            recordings.push({
              id: dbRec?.id,
              display_name: file,
              filename: relPath,
              title,
              created_at: stat.ctime,
              streamer_name: streamerName,
              size_mb: Number((stat.size / (1024 * 1024)).toFixed(2)),
              youtube_status: dbRec?.youtube_status,
              youtube_video_id: dbRec?.youtube_video_id,
              resolution: dbRec?.resolution,
              is_recording: dbRec?.is_recording
            });
          }
        }
      };
      walkSync(userDownloadsDir);
    }

    const streamerRecordings: Record<string, any[]> = {};
    for (const rec of recordings) {
      if (!streamerRecordings[rec.streamer_name]) streamerRecordings[rec.streamer_name] = [];
      streamerRecordings[rec.streamer_name].push(rec);
    }

    for (const key in streamerRecordings) {
      streamerRecordings[key].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return streamerRecordings;
  }

  async deleteRecording(filename: string, user: any) {
    if (!this.canAccessRecordingPath(filename, user)) {
      throw new ForbiddenException('권한이 없습니다.');
    }

    const filepath = path.join(this.downloadsDir, filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      
      const userDownloadsDir = path.join(this.downloadsDir, user.username);
      const dbLookupPath = path.relative(userDownloadsDir, filepath).replace(/\\/g, '/');
      await this.prisma.recording.deleteMany({
        where: { user_id: user.id, filename: dbLookupPath }
      });

      return { status: 'success', message: '녹화 영상이 삭제되었습니다.' };
    }
    throw new NotFoundException('녹화 영상을 찾을 수 없습니다.');
  }
}
