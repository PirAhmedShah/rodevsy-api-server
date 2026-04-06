import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Res,
} from '@nestjs/common';
import * as Express from 'express';
import { AuthService } from './auth.service';
import { LoginDto, SignupDto } from './dtos';
import { Cookies } from '@/common/decorators';
import { RefreshToken } from '@/infrastructure/jwt/jwt.entity';
import { UserRow } from '@/core/user/user.repository';
import type { Cookie } from '@/common/types';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  signup(@Body() dto: SignupDto): Promise<Partial<UserRow>> {
    return this.authService.signup(dto);
  }
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('fingerprint') fingerprint: string,
    @Headers('user-agent') userAgent: string,
    @Res({ passthrough: true }) res: Express.Response,
  ): Promise<null> {
    // 1. Pass metadata to service for login_history logging
    const { refreshToken } = await this.authService.login(dto, {
      ip,
      fingerprint: fingerprint || 'unknown',
      userAgent: userAgent || 'unknown',
    });

    // 2. Set the Refresh Token cookie using Entity constants
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth',
      maxAge: RefreshToken.LIFETIME * 1000,
    });
    return null;
  }
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Cookies('refreshToken') refreshToken: Cookie,
    @Res({ passthrough: true }) res: Express.Response,
  ): Promise<string> {
    try {
      return await this.authService.refresh(refreshToken);
    } catch (err) {
      // Token is missing or revoked → clear cookie
      res.cookie('refreshToken', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth', // Must match original path
        maxAge: 0, // Immediately expire
      });

      // Throw the error so client knows the refresh failed
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Cookies('refreshToken') refreshToken: Cookie,
    @Res({ passthrough: true }) res: Express.Response,
  ): Promise<{ message: string }> {
    // 1. Revoke the token in Redis (if it exists)
    await this.authService.logout(refreshToken);

    // 2. Clear the cookie on the client
    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth',
      maxAge: 0,
    });

    return { message: 'Logged out' };
  }
}
