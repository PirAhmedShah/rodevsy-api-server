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
    this.logger.log(`Signup attempt for username="${dto.username}"`);

    this.logger.verbose('Hashing password...');
    const hashedPassword = await this.hashService.hash(dto.password);

    this.logger.verbose('Mapping DTO to User entity...');
    const newUser = User.create({ ...dto, hashedPassword });

    this.logger.verbose('Persisting new user to database...');
    const saved = await this.userRepository.save(newUser);

    this.logger.log(
      `Signup successful — userId="${saved.id}" username="${dto.username}"`,
    );
    return saved;
  }

  async login(
    dto: LoginDto,
    metadata: { ip: string; fingerprint: string; userAgent: string },
  ) {
    this.logger.log(
      `Login attempt — username="${dto.username}" ip="${metadata.ip}" fingerprint="${metadata.fingerprint}"`,
    );

    this.logger.verbose(`Fetching user by username="${dto.username}"...`);
    const user = await this.userRepository.findByUsername(dto.username);

    if (!user) {
      this.logger.warn(
        `Login failed — user not found username="${dto.username}" ip="${metadata.ip}"`,
      );
    }

    this.logger.verbose('Verifying password...');
    const isPasswordValid =
      user &&
      (await this.hashService.verify(user.hashed_password, dto.password));

    if (user && !isPasswordValid) {
      this.logger.warn(
        `Login failed — invalid password username="${dto.username}" ip="${metadata.ip}"`,
      );
    }

    // Non-blocking audit log
    if (user) {
      this.logger.verbose(
        `Recording login attempt in audit log — userId="${user.id}" success=${!!isPasswordValid}`,
      );
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
        .catch((err) => {
          this.logger.error(
            `Failed to write login audit log — userId="${user.id}"`,
            err,
          );
        });
    }

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.verbose(
      `Credentials valid — creating refresh token for userId="${user.id}"`,
    );
    const refreshTokenEntity = RefreshToken.create(user.id, randomUUID());

    this.logger.verbose(
      `Storing refresh token in cache — userId="${user.id}" jti="${refreshTokenEntity.jti}"`,
    );
    await this.userCacheRepository.storeRefreshToken(refreshTokenEntity);

    this.logger.verbose('Signing refresh token...');
    const refreshToken = await this.jwtService.sign(refreshTokenEntity);

    this.logger.log(
      `Login successful — userId="${user.id}" username="${dto.username}" ip="${metadata.ip}"`,
    );
    return { refreshToken };
  }

  async refresh(refreshTokenStr: Cookie) {
    this.logger.debug('Refresh token request received.');

    if (!refreshTokenStr) {
      this.logger.warn('Refresh failed — no token in cookie.');
      throw new UnauthorizedException('Refresh token is missing.');
    }

    this.logger.verbose('Verifying refresh token signature and expiry...');
    const { payload } = await this.jwtService.verify(
      refreshTokenStr,
      JwtType.REFRESH,
    );

    const refreshToken = RefreshToken.fromPayload(payload);
    this.logger.verbose(
      `Refresh token decoded — sub="${refreshToken.sub}" jti="${refreshToken.jti}"`,
    );

    this.logger.verbose(
      `Checking whitelist — sub="${refreshToken.sub}" jti="${refreshToken.jti}"`,
    );
    const isWhitelisted =
      await this.userCacheRepository.isTokenStored(refreshToken);

    if (!isWhitelisted) {
      this.logger.warn(
        `Refresh denied — token revoked or not in whitelist — sub="${refreshToken.sub}" jti="${refreshToken.jti}"`,
      );
      throw new ForbiddenException('Token revoked');
    }

    this.logger.verbose(`Issuing new access token — sub="${refreshToken.sub}"`);
    const newAccessToken = AccessToken.create(refreshToken.sub, randomUUID());
    const signed = await this.jwtService.sign(newAccessToken);

    this.logger.log(
      `Token refreshed successfully — sub="${refreshToken.sub}" jti="${newAccessToken.jti}"`,
    );
    return signed;
  }

  async logout(refreshTokenStr: Cookie) {
    this.logger.debug('Logout request received.');

    if (!refreshTokenStr) {
      this.logger.verbose(
        'No refresh token present — user already logged out, skipping revocation.',
      );
      return;
    }

    try {
      this.logger.verbose('Verifying refresh token for logout...');
      const { payload } = await this.jwtService.verify(
        refreshTokenStr,
        JwtType.REFRESH,
      );

      const token = RefreshToken.fromPayload(payload);
      this.logger.verbose(
        `Revoking refresh token — sub="${token.sub}" jti="${token.jti}"`,
      );

      await this.userCacheRepository.revokeRefreshToken(token);
      this.logger.log(
        `Logout successful — sub="${token.sub}" jti="${token.jti}"`,
      );
    } catch (e) {
      this.logger.error(
        'Logout error — token invalid or already expired, skipping revocation.',
        e,
      );
    }
  }
}
