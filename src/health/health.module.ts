import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PgHealthIndicator } from './indicators/pg-health.indicator';
import { DbModule } from 'src/db/db.module';
import { TerminusModule } from '@nestjs/terminus';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { CacheModule } from 'src/cache/cache.module';

@Module({
  imports: [DbModule, CacheModule, TerminusModule],
  controllers: [HealthController],
  providers: [PgHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
