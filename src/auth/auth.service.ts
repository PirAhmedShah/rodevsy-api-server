/* The AuthService class in this TypeScript file handles user authentication, including signup, login,
and token refreshing functionalities. */
// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { LoginDto, SignupDto } from './dto';
import { JwtService } from 'src/jwt/jwt.service';
import { HashService } from 'src/hash/hash.service';
import { UserRepository } from 'src/db/repository/user.repository';
import { JwtType } from 'src/jwt/jwt.type';
import { UserCacheRepository } from 'src/cache/repository';
import { User } from 'src/entities';
import { AccessToken, RefreshToken } from 'src/entities/token.entity';
import { randomUUID } from 'crypto';
import { LoginLog } from 'src/entities/login_log.entity';
import { Cookie } from './auth.type';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly userRepository: UserRepository,
    private readonly hashService: HashService,
    private readonly jwtService: JwtService,
    private readonly userCacheRepository: UserCacheRepository,
  ) {
    this.logger.debug('Constructed.');
  }

  async signup(dto: SignupDto) {
    // 1. Transformation: Plain password -> Hash
    const hashedPassword = await this.hashService.hash(dto.password);

    // 2. Mapping: DTO -> Domain Entity (Plain Object or Class)
    const newUser = User.create({ ...dto, hashedPassword });

    // 3. Persistence: Hand off the completed entity to the Repo
    return await this.userRepository.save(newUser);
  }
  async login(
    dto: LoginDto,
    metadata: { ip: string; fingerprint: string; userAgent: string },
  ) {
    this.logger.debug('Dto', dto);
    // 1. Transformation: Fetch user and verify credentials
    const user = await this.userRepository.findByUsername(dto.username);

    const isPasswordValid =
      user &&
      (await this.hashService.verify(user.hashed_password, dto.password));

    // 2. Logging: Record login attempt (best effort, non-blocking)
    if (user) {
      this.userRepository
        .logLogin(
          LoginLog.create({
            ...metadata,
            userId: user.id,
            success: !!isPasswordValid,
            jti: null,
            used2fa: false,
          }),
        )
        .catch(() => {}); // ignore audit failures
    }

    // 3. Gatekeeping: Reject invalid credentials
    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Mapping: Create domain session entities
    const accessTokenEntity = AccessToken.create(user.id, randomUUID());
    const refreshTokenEntity = RefreshToken.create(user.id, randomUUID());

    // 5. Presistence: Store refresh token in cache (whitelist)
    await this.userCacheRepository.storeRefreshToken(refreshTokenEntity);

    // 6. Presentation: Sign tokens for transport
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.sign(accessTokenEntity),
      this.jwtService.sign(refreshTokenEntity),
    ]);

    return { accessToken, refreshToken, user: {} }; //sending empty object for now, will be implemented
  }

  async refresh(refreshTokenStr: Cookie) {
    this.logger.debug('Refreshing token...');

    if (!refreshTokenStr) {
      throw new UnauthorizedException('Refresh token is missing.');
    }

    // JwtService already maps jose errors → 401/403
    const { payload } = await this.jwtService.verify(
      refreshTokenStr,
      JwtType.REFRESH,
    );

    const refreshToken = RefreshToken.fromPayload(payload);

    const isWhitelisted =
      await this.userCacheRepository.isTokenStored(refreshToken);

    if (!isWhitelisted) {
      throw new ForbiddenException('Token revoked');
    }

    const newAccessToken = AccessToken.create(refreshToken.sub, randomUUID());

    return await this.jwtService.sign(newAccessToken);
  }

  async logout(refreshTokenStr: Cookie) {
    if (!refreshTokenStr) return; // Already logged out

    try {
      const { payload } = await this.jwtService.verify(
        refreshTokenStr,
        JwtType.REFRESH,
      );

      const token = RefreshToken.fromPayload(payload);
      await this.userCacheRepository.revokeRefreshToken(token);
    } catch (e) {
      this.logger.error('Error logging out.', e);
      // If token is invalid/expired, we don't care, it's already useless
    }
  }
}
