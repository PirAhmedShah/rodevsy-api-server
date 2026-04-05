import { UserRepository } from './user.repository';
import { UserCacheRepository } from './user.cache.repository';
import { Module } from '@nestjs/common';
import { CacheModule } from '@/infrastructure/cache/cache.module';
import { DbModule } from '@/infrastructure/db/db.module';

@Module({
  imports: [CacheModule, DbModule],
  providers: [UserRepository, UserCacheRepository],
  exports: [UserRepository, UserCacheRepository],
})
export class UserModule {}
