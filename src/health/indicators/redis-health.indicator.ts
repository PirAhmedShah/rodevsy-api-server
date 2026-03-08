import { Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { CacheService } from 'src/cache/cache.service';

@Injectable()
export class RedisHealthIndicator {
  private readonly checkKey = 'redis';
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      /**
       * 1. Execute 'INFO' via the pool's execute method.
       * Based on your .d.ts, execute() takes a task function that receives a client.
       */
      const info = await this.cacheService.pool.execute((client) =>
        client.info(),
      );

      // 2. Parse metrics
      const metrics = this.parseRedisInfo(info);

      const usedMemoryMb =
        (parseInt(metrics.used_memory || '0', 10) / 1024 / 1024).toFixed(2) +
        'MB';
      const totalSystemMemoryMb =
        (
          parseInt(metrics.total_system_memory || '0', 10) /
          1024 /
          1024
        ).toFixed(2) + 'MB';
      const fragmentationRatio = metrics.mem_fragmentation_ratio || '0';

      // 3. Logic for warnings
      const usedMemoryBytes = parseInt(metrics.used_memory || '0', 10);
      const fragRatio = parseFloat(metrics.mem_fragmentation_ratio || '0');

      // 3. Logic for warnings:
      /*
        When you divide 15MB by a tiny amount of data, the math results in that scary-looking 15.54 ratio.
        The "Empty Redis" False Positive

        In a fresh or empty Redis instance:

            Actual Data: ~800KB

            Process Overhead: ~12MB

            Math: 12/0.8=15.0

        This is a classic "false positive" in monitoring. You shouldn't worry about fragmentation until you have at least 100MB of data stored.
        Only log a WARN if ratio > 1.5 AND used memory is > 64MB
        */
      if (fragRatio > 1.5 && usedMemoryBytes > 64 * 1024 * 1024) {
        this.logger.warn(
          `High Redis Fragmentation Ratio: ${fragRatio}. Total used: ${usedMemoryMb}`,
        );
      }

      // 4. Return status using the correct pool property names from your .d.ts
      return this.healthIndicatorService.check(this.checkKey).up({
        poolTotal: this.cacheService.pool.totalClients,
        poolIdle: this.cacheService.pool.idleClients,
        poolInUse: this.cacheService.pool.clientsInUse,
        poolWaitingTasks: this.cacheService.pool.tasksQueueLength,

        redisUsedMemory: usedMemoryMb,
        redisTotalMemory: totalSystemMemoryMb,
        redisFragmentationRatio: fragmentationRatio,
        redisClients: metrics.connected_clients,
      });
    } catch (e) {
      this.logger.error(
        'Redis health check failed',
        e instanceof Error ? e.stack : e,
      );

      return this.healthIndicatorService.check(this.checkKey).down({
        message: 'Redis connection failed.',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private parseRedisInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    // Split by any newline format and filter out comments/empty lines
    const lines = info.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, value] = trimmed.split(':');
        if (key && value) {
          result[key.trim()] = value.trim();
        }
      }
    }
    return result;
  }
}
