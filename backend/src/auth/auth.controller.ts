import { Controller, Post, Body, Get, Delete, Param, UseGuards, Req, Res, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import * as qrcode from 'qrcode';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService
  ) {}

  @Get('status')
  async getStatus() {
    const count = await this.prisma.user.count();
    const settings = await this.prisma.settings.findFirst();
    return {
      initialized: count > 0 && settings?.initialized,
    };
  }

  @Post('setup')
  async setupAdmin(@Body() body: any, @Res({ passthrough: true }) res: any) {
    const { username, password } = body;
    if (!username || !password) throw new BadRequestException('Username and password required');
    const { access_token } = await this.authService.setupAdmin(username, password);
    res.cookie('jwt', access_token, { httpOnly: true });
    return { status: 'success' };
  }

  @Post('login')
  async login(@Body() body: any, @Res({ passthrough: true }) res: any) {
    const { username, password, otp } = body;
    const user = await this.authService.validateUser(username, password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (dbUser && dbUser.totp_enabled && dbUser.totp_secret) {
      if (!otp) {
        return { requireOtp: true };
      }
      const { authenticator } = require('otplib');
      const isCodeValid = authenticator.verify({
        token: otp,
        secret: dbUser.totp_secret,
      });
      if (!isCodeValid) {
        throw new UnauthorizedException('Invalid OTP');
      }
    }

    const { access_token } = await this.authService.login(user);
    res.cookie('jwt', access_token, { httpOnly: true });
    return { status: 'success', user: { username: dbUser?.username, is_admin: dbUser?.is_admin } };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: any) {
    res.clearCookie('jwt');
    return { status: 'success' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    return {
      username: user?.username,
      is_admin: user?.is_admin,
      totp_enabled: user?.totp_enabled,
      has_secret: !!user?.totp_secret,
      has_cookies: !!(user?.nid_aut && user?.nid_ses),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Req() req: any, @Body() body: any) {
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) throw new BadRequestException('현재 비밀번호와 새 비밀번호를 입력해주세요.');
    return this.authService.changePassword(req.user.id, currentPassword, newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users')
  async listUsers(@Req() req: any) {
    return this.authService.listUsers(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('users')
  async createUser(@Req() req: any, @Body() body: any) {
    const { username, password, is_admin } = body;
    if (!username || !password) throw new BadRequestException('사용자명과 비밀번호를 입력해주세요.');
    return this.authService.createUser(req.user.id, username, password, !!is_admin);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('users/:id')
  async deleteUser(@Req() req: any, @Param('id') id: string) {
    return this.authService.deleteUser(req.user.id, id);
  }



  @UseGuards(JwtAuthGuard)
  @Post('verify-cookies')
  async verifyCookies(@Req() req: any, @Body() body: any) {
    const { nid_aut, nid_ses } = body;
    if (!nid_aut || !nid_ses) throw new BadRequestException('쿠키 값을 입력해주세요.');
    return this.authService.verifyCookies(nid_aut, nid_ses);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  async setup2fa(@Req() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (user?.totp_enabled) {
      throw new BadRequestException('2FA is already enabled');
    }
    const { secret, otpauthUrl } = await this.authService.generateTwoFactorAuthenticationSecret(user);
    const qrcode_data_url = await qrcode.toDataURL(otpauthUrl);
    return { status: 'success', secret, otpauthUrl, qrcode_data_url };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  async verify2fa(@Req() req: any, @Body() body: any) {
    return this.authService.verifyTwoFactorAuthentication(body.otp, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  async disable2fa(@Req() req: any) {
    return this.authService.disableTwoFactorAuthentication(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('user-settings')
  async getUserSettings(@Req() req: any) {
    return this.authService.getUserSettings(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('user-settings')
  async updateUserSettings(@Req() req: any, @Body() body: any) {
    return this.authService.updateUserSettings(
      req.user.id,
      body.discord_webhook_url !== undefined ? body.discord_webhook_url : undefined,
      body.youtube_client_id !== undefined ? body.youtube_client_id : undefined,
      body.youtube_client_secret !== undefined ? body.youtube_client_secret : undefined,
      body.nid_aut !== undefined ? body.nid_aut : undefined,
      body.nid_ses !== undefined ? body.nid_ses : undefined
    );
  }
}
