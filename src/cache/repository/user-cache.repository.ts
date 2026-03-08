// src/cache/repository/user-cache.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache.service';
import { RefreshToken } from 'src/entities/token.entity';
@Injectable()
export class UserCacheRepository {
  private readonly logger = new Logger(UserCacheRepository.name);
  private readonly PREFIX = 'auth:jti:';

  constructor(private readonly cacheService: CacheService) {}

  // Explicitly add the return type : Promise<any> or : Promise<unknown>
  async storeRefreshToken(token: RefreshToken): Promise<void> {
    const key = this.PREFIX + token.sub;
    const now = Math.floor(Date.now() / 1000);

    this.logger.verbose(
      `Storing JTI: ${token.jti} with Expiry: ${token.expiresAt}`,
    );

    await this.cacheService.execute(async (client) => {
      const multi = client.multi();

      // 1. Cleanup expired
      multi.zRemRangeByScore(key, 0, now);

      // 2. Add new
      multi.zAdd(key, {
        score: token.expiresAt,
        value: token.jti,
      });

      multi.expire(key, RefreshToken.LIFETIME);

      return await multi.exec();
    });
  }
  async isTokenStored(token: RefreshToken): Promise<boolean> {
    this.logger.verbose(
      `Checking if token ${token.jti} for ${token.sub} is stored...`,
    );
    const key = this.PREFIX + token.sub;
    const score = await this.cacheService.execute(async (c) => {
      const sc = await c.zScore(key, token.jti);
      this.logger.debug(`Token ${token.jti} is stored.`);
      return sc;
    });

    if (score === null) return false;

    // Double-check: Is the stored expiration actually in the future?
    const now = Math.floor(Date.now() / 1000);
    this.logger.debug(
      `VALIDATION: ${score} is the score.. is it greater than ${now} and indeed its ${score > now}`,
    );
    return score > now;
  }
  async revokeRefreshToken(token: RefreshToken): Promise<void> {
    this.logger.verbose(`Revoking token ${token.jti} for ${token.sub}`);
    const key = this.PREFIX + token.sub;
    await this.cacheService.execute(async (client) => {
      this.logger.debug(`Removing ${token.jti}`);
      // Remove specifically the JTI associated with this token
      const removed = await client.ZREM(key, token.jti);
      this.logger.debug(`Entries removed ${removed}`);
      return removed;
    });
  }
}
