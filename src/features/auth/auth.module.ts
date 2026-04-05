import { Module } from '@nestjs/common';
import { CacheModule } from '@/infrastructure/cache/cache.module';
import { DbModule } from '@/infrastructure/db/db.module';
import { HashModule } from '@/infrastructure/hash/hash.module';
import { JwtModule } from '@/infrastructure/jwt/jwt.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '@/core/user/user.module';

@Module({
  providers: [AuthService],
  controllers: [AuthController],
  imports: [HashModule, DbModule, JwtModule, CacheModule, UserModule],
  exports: [AuthService],
})
export class AuthModule {}
