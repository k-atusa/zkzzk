import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { extractChannelId, getChannelInfo } from '../utils/chzzk.utils';
import axios from 'axios';

@Injectable()
export class StreamersService {
  constructor(private prisma: PrismaService) {}

  async addStreamer(channel_url: string, user: any) {
    const channel_id = extractChannelId(channel_url);
    if (!channel_id) throw new BadRequestException('올바른 치지직 URL이 아닙니다.');

    try {
      const url = `https://api.chzzk.naver.com/service/v3/channels/${channel_id}/live-detail`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        }
      });
      if (response.data?.code !== 200) {
        throw new BadRequestException('치지직 이용 약관을 위반하여 정지된 채널입니다.');
      }
    } catch (e) {
      throw new BadRequestException('채널 확인 중 오류가 발생했습니다.');
    }

    const nickname = await getChannelInfo(channel_id);
    if (!nickname) throw new BadRequestException('채널 정보를 가져올 수 없습니다.');

    const existing = await this.prisma.streamer.findUnique({
      where: {
        user_id_channel_url: {
          user_id: user.id,
          channel_url: channel_url
        }
      }
    });

    if (existing) throw new BadRequestException('이미 등록된 채널입니다.');

    const streamer = await this.prisma.streamer.create({
      data: {
        channel_url,
        nickname,
        user_id: user.id,
        cookie_user_id: user.id,
        is_active: true,
        created_at: new Date(),
        is_recording: false
      }
    });

    return streamer;
  }

  async removeStreamer(streamerId: string, user: any) {
    const streamer = await this.prisma.streamer.findUnique({ where: { id: streamerId } });
    if (!streamer) throw new NotFoundException('스트리머를 찾을 수 없습니다.');
    if (streamer.user_id !== user.id && !user.is_admin) throw new ForbiddenException('권한이 없습니다.');

    if (streamer.is_recording && streamer.process_id) {
      try {
        process.kill(streamer.process_id, 'SIGTERM');
      } catch (e) {}
    }

    await this.prisma.recording.deleteMany({ where: { streamer_id: streamerId } });
    await this.prisma.streamer.delete({ where: { id: streamerId } });

    return { status: 'success' };
  }

  async getStreamers(user: any) {
    if (user.is_admin) {
      return this.prisma.streamer.findMany({ include: { user: true } });
    }
    return this.prisma.streamer.findMany({ where: { user_id: user.id } });
  }

  async stopRecording(streamerId: string, user: any) {
    const streamer = await this.prisma.streamer.findUnique({ where: { id: streamerId } });
    if (!streamer) throw new NotFoundException('스트리머를 찾을 수 없습니다.');
    if (streamer.user_id !== user.id && !user.is_admin) throw new ForbiddenException('권한이 없습니다.');

    if (streamer.is_recording && streamer.process_id) {
      try {
        process.kill(streamer.process_id, 'SIGTERM');
      } catch (e) {}
      
      await this.prisma.streamer.update({
        where: { id: streamerId },
        data: {
          is_recording: false,
          current_broadcast_title: null,
          process_id: null
        }
      });
      return { status: 'success' };
    }
    throw new BadRequestException('녹화 중이 아닙니다.');
  }

  async setStreamerCookies(streamerId: string, cookieUserId: string | null, user: any) {
    const streamer = await this.prisma.streamer.findUnique({ where: { id: streamerId } });
    if (!streamer) throw new NotFoundException('스트리머를 찾을 수 없습니다.');
    if (streamer.user_id !== user.id && !user.is_admin) throw new ForbiddenException('권한이 없습니다.');

    if (cookieUserId) {
      const cookieUser = await this.prisma.user.findUnique({ where: { id: cookieUserId } });
      if (!cookieUser) throw new BadRequestException('쿠키 사용자를 찾을 수 없습니다.');
      if (!cookieUser.nid_aut || !cookieUser.nid_ses) {
        throw new BadRequestException('해당 사용자의 쿠키가 설정되지 않았습니다.');
      }
    }

    await this.prisma.streamer.update({
      where: { id: streamerId },
      data: { cookie_user_id: cookieUserId }
    });

    return { status: 'success' };
  }
}
