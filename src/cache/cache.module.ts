import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { UserCacheRepository } from './repository/user-cache.repository';

@Module({
  providers: [CacheService, UserCacheRepository],
  exports: [CacheService, UserCacheRepository],
})
export class CacheModule {}
