import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { PgHealthIndicator } from './indicators/pg-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  constructor(
    private readonly configService: ConfigService,
    private readonly healthCheckService: HealthCheckService,
    private readonly memoryHealthIndicator: MemoryHealthIndicator,
    private readonly pgHealthIndicator: PgHealthIndicator,
    private readonly redisHealthIndicator: RedisHealthIndicator, // [2] Inject the indicator
  ) {}

  private getMaxHeapThresholdBytes() {
    const maxHeapThresholdMB = this.configService.getOrThrow<number>(
      'MAX_HEAP_THRESHOLD_MB',
    );
    return maxHeapThresholdMB * 1024 * 1024;
  }

  @Get('live')
  async live() {
    try {
      const result = await this.healthCheckService.check([
        () =>
          this.memoryHealthIndicator.checkHeap(
            'memory_heap',
            this.getMaxHeapThresholdBytes(),
          ),
      ]);
      return result;
    } catch (e) {
      const memoryUsage = process.memoryUsage();
      const maxHeapAllowed = this.getMaxHeapThresholdBytes();
      this.logger.error('Memory heap issue: ', {
        heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
        heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
        maxHeap: (maxHeapAllowed / 1024 / 1024).toFixed(2) + 'MB',
        usedToMaxHeapPercent:
          ((memoryUsage.heapUsed / maxHeapAllowed) * 100).toFixed(2) + '%',
      });
      throw e;
    }
  }

  @Get('ready')
  ready() {
    // [3] Include both Postgres and Redis in the readiness check
    return this.healthCheckService.check([
      () => this.pgHealthIndicator.isHealthy(),
      () => this.redisHealthIndicator.isHealthy(),
    ]);
  }
}
