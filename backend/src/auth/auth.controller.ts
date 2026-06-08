import { Controller, Post, Body, Get, UseGuards, Req, Res, UnauthorizedException, BadRequestException } from '@nestjs/common';
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
      has_secret: !!user?.totp_secret
    };
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
}
