import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private checkWerkzeugHash(password: string, hash: string): boolean {
    // werkzeug format: scrypt:N:r:p$salt$hash or pbkdf2:sha256:iterations$salt$hash
    try {
      const parts = hash.split('$');
      if (parts.length !== 3) return false;
      const methodParts = parts[0].split(':');
      const salt = parts[1];
      const actualHash = parts[2];

      if (methodParts[0] === 'scrypt') {
        const N = parseInt(methodParts[1], 10);
        const r = parseInt(methodParts[2], 10);
        const p = parseInt(methodParts[3], 10);
        
        const saltBuffer = Buffer.from(salt, 'base64');
        const hashBuffer = Buffer.from(actualHash, 'base64');
        
        const derived = crypto.scryptSync(password, saltBuffer, hashBuffer.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
        return crypto.timingSafeEqual(hashBuffer, derived);
      } else if (methodParts[0] === 'pbkdf2') {
        // fallback
      }
      return false;
    } catch (e) {
      console.error('Error verifying hash', e);
      return false;
    }
  }

  private hashPassword(pass: string): string {
    const salt = crypto.randomBytes(16);
    const N = 32768, r = 8, p = 1;
    const derived = crypto.scryptSync(pass, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return `scrypt:${N}:${r}:${p}$${salt.toString('base64').replace(/=/g, '')}$${derived.toString('base64').replace(/=/g, '')}`;
  }

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) return null;

    let isMatch = false;
    if (user.password_hash.startsWith('scrypt:') || user.password_hash.startsWith('pbkdf2:')) {
      isMatch = this.checkWerkzeugHash(pass, user.password_hash);
    } else {
      isMatch = false;
    }

    if (isMatch) {
      const { password_hash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { username: user.username, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async setupAdmin(username: string, pass: string) {
    const count = await this.prisma.user.count();
    if (count > 0) {
      throw new BadRequestException('Admin already exists');
    }
    
    const hashStr = this.hashPassword(pass);

    const user = await this.prisma.user.create({
      data: {
        username,
        password_hash: hashStr,
        is_admin: true,
        created_at: new Date()
      }
    });

    let settings = await this.prisma.settings.findFirst();
    if (!settings) {
      await this.prisma.settings.create({ data: { initialized: true } });
    } else {
      await this.prisma.settings.update({ where: { id: settings.id }, data: { initialized: true } });
    }

    return this.login(user);
  }

  async changePassword(userId: string, currentPass: string, newPass: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    const isMatch = this.checkWerkzeugHash(currentPass, user.password_hash);
    if (!isMatch) throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');

    if (newPass.length < 6) throw new BadRequestException('새 비밀번호는 6자 이상이어야 합니다.');

    const newHash = this.hashPassword(newPass);
    await this.prisma.user.update({ where: { id: userId }, data: { password_hash: newHash } });
    return { success: true };
  }

  async listUsers(requesterId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester?.is_admin) throw new ForbiddenException('관리자 권한이 필요합니다.');

    const users = await this.prisma.user.findMany({
      select: { id: true, username: true, is_admin: true, created_at: true, nid_aut: true, nid_ses: true }
    });
    return users.map(u => ({
      id: u.id,
      username: u.username,
      is_admin: u.is_admin,
      created_at: u.created_at
    }));
  }

  async createUser(requesterId: string, username: string, pass: string, isAdmin: boolean) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester?.is_admin) throw new ForbiddenException('관리자 권한이 필요합니다.');

    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) throw new BadRequestException('이미 존재하는 사용자명입니다.');

    if (pass.length < 6) throw new BadRequestException('비밀번호는 6자 이상이어야 합니다.');

    const hashStr = this.hashPassword(pass);
    const user = await this.prisma.user.create({
      data: { username, password_hash: hashStr, is_admin: isAdmin, created_at: new Date() }
    });

    return { id: user.id, username: user.username, is_admin: user.is_admin };
  }

  async deleteUser(requesterId: string, targetUserId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester?.is_admin) throw new ForbiddenException('관리자 권한이 필요합니다.');
    if (requesterId === targetUserId) throw new BadRequestException('자기 자신은 삭제할 수 없습니다.');

    await this.prisma.user.delete({ where: { id: targetUserId } });
    return { success: true };
  }



  async verifyCookies(nid_aut: string, nid_ses: string) {
    try {
      const commonHeaders = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Origin': 'https://chzzk.naver.com',
        'Referer': 'https://chzzk.naver.com/',
        'front-client-platform-type': 'PC',
        'front-client-product-type': 'web',
        'if-modified-since': 'Mon, 26 Jul 1997 05:00:00 GMT',
        'Cookie': `NID_AUT=${nid_aut}; NID_SES=${nid_ses}`,
      };

      // 쿠키 유효성 확인 (팔로잉 API)
      const followRes = await axios.get(
        'https://api.chzzk.naver.com/service/v1/channels/followings?page=0&size=1&sortType=FOLLOW',
        { headers: commonHeaders }
      );
      if (followRes.data?.code !== 200) return { valid: false };

      // 닉네임 조회
      const userRes = await axios.get(
        'https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus',
        { headers: commonHeaders }
      );
      const nickname = userRes.data?.content?.nickname ?? null;

      return { valid: true, nickname };
    } catch (e) {
      return { valid: false };
    }
  }

  async generateTwoFactorAuthenticationSecret(user: any) {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.username, 'ZKZZK', secret);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { totp_secret: secret, totp_enabled: false }
    });

    return { secret, otpauthUrl };
  }

  async verifyTwoFactorAuthentication(code: string, user: any) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !dbUser.totp_secret) {
      throw new BadRequestException('2FA not initialized');
    }

    const isCodeValid = authenticator.verify({
      token: code,
      secret: dbUser.totp_secret,
    });

    if (!isCodeValid) {
      throw new BadRequestException('Invalid OTP');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { totp_enabled: true }
    });

    return { enabled: true };
  }

  async disableTwoFactorAuthentication(user: any) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totp_enabled: false, totp_secret: null }
    });
    return { enabled: false };
  }

  async getUserSettings(requesterId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: requesterId } });
    return {
      discord_webhook_url: user?.discord_webhook_url || null,
      discord_webhook_use_embed: user?.discord_webhook_use_embed ?? true,
      youtube_client_id: user?.youtube_client_id || null,
      youtube_client_secret: user?.youtube_client_secret || null,
      youtube_connected: !!user?.youtube_refresh_token,
      youtube_auto_upload: user?.youtube_auto_upload ?? true,
      delete_after_upload: user?.delete_after_upload ?? false,
      nid_aut: user?.nid_aut || null,
      nid_ses: user?.nid_ses || null,
      live_resolution: user?.live_resolution || '1080p',
      vod_resolution: user?.vod_resolution || '1080p',
    };
  }

  async updateUserSettings(requesterId: string, discord_webhook_url?: string | null, youtube_client_id?: string | null, youtube_client_secret?: string | null, nid_aut?: string | null, nid_ses?: string | null, youtube_auto_upload?: boolean, delete_after_upload?: boolean, live_resolution?: string, vod_resolution?: string, discord_webhook_use_embed?: boolean) {
    const updateData: any = {};
    if (discord_webhook_url !== undefined) updateData.discord_webhook_url = discord_webhook_url;
    if (discord_webhook_use_embed !== undefined) updateData.discord_webhook_use_embed = discord_webhook_use_embed;
    if (youtube_client_id !== undefined) updateData.youtube_client_id = youtube_client_id;
    if (youtube_client_secret !== undefined) updateData.youtube_client_secret = youtube_client_secret;
    if (nid_aut !== undefined) updateData.nid_aut = nid_aut;
    if (nid_ses !== undefined) updateData.nid_ses = nid_ses;
    if (youtube_auto_upload !== undefined) updateData.youtube_auto_upload = youtube_auto_upload;
    if (delete_after_upload !== undefined) updateData.delete_after_upload = delete_after_upload;
    if (live_resolution !== undefined) updateData.live_resolution = live_resolution;
    if (vod_resolution !== undefined) updateData.vod_resolution = vod_resolution;

    await this.prisma.user.update({
      where: { id: requesterId },
      data: updateData
    });
    return { success: true };
  }
}
