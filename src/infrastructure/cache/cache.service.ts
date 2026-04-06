import { ExitCode, ExitCodesDescription } from '@/common/enums/exit_codes.enum';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { RedisClientPoolType, createClientPool } from 'redis';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  pool?: RedisClientPoolType;

  constructor(private readonly configService: ConfigService) {
    this.logger.debug('Constructed.');
  }

  async onModuleInit(): Promise<void> {
    const CACHE_POOL_MAX_CONNECTIONS = Number(
        this.configService.getOrThrow('CACHE_POOL_MAX_CONNECTIONS'),
      ),
      CACHE_POOL_MIN_CONNECTIONS = Number(
        this.configService.getOrThrow('CACHE_POOL_MIN_CONNECTIONS'),
      );

    if (isNaN(CACHE_POOL_MAX_CONNECTIONS) || isNaN(CACHE_POOL_MIN_CONNECTIONS))
      throw new Error(
        'CACHE_POOL_MAX_CONNECTIONS or CACHE_POOL_MIN_CONNECTIONS is NaN.',
      );

    this.pool = createClientPool(
      {
        url: `redis://:${this.readPassword()}@${this.configService.getOrThrow<string>('CACHE_HOST')}:${this.configService.getOrThrow<string>('CACHE_PORT')}`,
      },
      {
        maximum: CACHE_POOL_MAX_CONNECTIONS,
        minimum: CACHE_POOL_MIN_CONNECTIONS,
      },
    );

    this.pool.on('error', (err) => {
      this.logger.error('[REDIS POOL]: ', err);
      process.kill(process.pid, 'SIGTERM');
    });

    this.pool.on('open', () => {
      this.logger.debug('Connection pool opened.');
    });
    await this.pool.connect();
    await this.performHealthCheck();

    this.logger.debug('Initialized.');
  }

  /**
   * Validates the connection to Redis.
   * Exits the process if the initial connection fails, matching DbService logic.
   */
  async performHealthCheck(): Promise<void> {
    this.logger.warn('Checking Health...');
    try {
      if (!this.pool)
        throw new Error(
          'Attempted to check health before cache pool initialization.',
        );
      await this.pool.ping();
      this.logger.log('Healthy.');
    } catch (e) {
      this.logger.fatal(
        `Failed Liveness Probe check, Terminating with code ${String(ExitCode.CACHE_CONNECTION_ERROR)} (${ExitCodesDescription[ExitCode.CACHE_CONNECTION_ERROR]})`,
        e,
      );

      process.kill(process.pid, 'SIGTERM');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.debug('Closing...');
    if (this.pool) {
      this.logger.debug('Connection is open!, closing it...');
      await this.pool.close();
    }
    this.logger.debug('Destroyed.');
  }

  /**
   * Wrapper to execute Redis commands with logging and performance tracking.
   * Usage: const val = await cacheService.execute(c => c.get('key'));
   */
  async execute<T>(
    fn: (client: RedisClientPoolType) => Promise<T>,
  ): Promise<T> {
    const id = randomUUID(),
      startMark = `cache:${id}:start`,
      endMark = `cache:${id}:end`;

    performance.mark(startMark);

    try {
      this.logger.debug(`Executing... [ID: ${id}]`);
      if (!this.pool)
        throw new Error(
          'Attempted to execute before cache pool initialization.',
        );
      return await fn(this.pool);
    } catch (error) {
      this.logger.error(
        `Operation Failed [ID: ${id}]`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    } finally {
      performance.mark(endMark);

      const measure = performance.measure(
        'cache.operation',
        startMark,
        endMark,
      );

      this.logger.debug(
        `[PERF] Operation [ID: ${id}] took ${measure.duration.toFixed(2)}ms`,
      );

      performance.clearMeasures(measure.name);
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    }
  }

  private readPassword(): string {
    try {
      const path = this.configService.getOrThrow<string>('CACHE_PASSWORD_FILE');
      return readFileSync(path, 'utf-8').trim();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : e;
      throw new Error(`Could not read CACHE password file: ${String(error)}`, {
        cause: e,
      });
    }
  }
}
