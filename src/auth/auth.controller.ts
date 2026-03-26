import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Res,
} from '@nestjs/common';
import * as Express from 'express'; // Fixes TS1272: namespace import
import { AuthService } from './auth.service';
import { LoginDto, SignupDto } from './dto';
import { Cookies } from 'src/decorators';
import { RefreshToken } from 'src/entities/token.entity';
import type { Cookie } from './auth.type';
// ... other imports

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('fingerprint') fingerprint: string,
    @Headers('user-agent') userAgent: string,
    @Res() res: Express.Response,
  ) {
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
  ) {
    try {
      return await this.authService.refresh(refreshToken);
    } catch (err) {
      // Token is missing or revoked → clear cookie
      res.cookie('refreshToken', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth', // must match original path
        maxAge: 0, // immediately expire
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
  ) {
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
