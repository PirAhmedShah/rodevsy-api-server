import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { HashModule } from 'src/hash/hash.module';
import { DbModule } from 'src/db/db.module';
import { JwtModule } from 'src/jwt/jwt.module';
import { CacheModule } from 'src/cache/cache.module';
@Module({
  providers: [AuthService],
  controllers: [AuthController],
  imports: [HashModule, DbModule, JwtModule, CacheModule],
  exports: [AuthService],
})
export class AuthModule {}
