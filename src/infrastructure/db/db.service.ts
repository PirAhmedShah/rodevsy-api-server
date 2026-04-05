import { ExitCode, ExitCodesDescription } from '@/common/enums';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  pool: Pool | undefined;

  constructor(private readonly configService: ConfigService) {
    this.logger.debug('Constructed.');
  }

  async onModuleInit(): Promise<void> {
    const DB_POOL_MAX = Number(
      this.configService.getOrThrow('DB_POOL_MAX_CONNECTIONS'),
    );
    const DB_POOL_MIN = Number(
      this.configService.getOrThrow('DB_POOL_MIN_CONNECTIONS'),
    );
    const DB_PORT = Number(this.configService.getOrThrow('DB_PORT'));

    if (isNaN(DB_POOL_MAX) || isNaN(DB_POOL_MIN) || isNaN(DB_PORT)) {
      throw new Error(
        'DB_POOL_MAX_CONNECTIONS, DB_POOL_MIN_CONNECTIONS, or DB_PORT is NaN.',
      );
    }

    this.pool = new Pool({
      host: this.configService.getOrThrow('DB_HOST'),
      port: DB_PORT,
      user: this.configService.getOrThrow('DB_USER'),
      database: this.configService.getOrThrow('DB_NAME'),
      password: this.readPassword(),
      min: DB_POOL_MIN,
      max: DB_POOL_MAX,
    });

    this.pool.on('error', (err) => {
      this.logger.error('[DB POOL ERROR]: ', err);
      process.kill(process.pid, 'SIGTERM');
    });

    // Await to ensure health check completes before app starts
    await this.performHealthChecks();

    this.logger.debug('Initialized.');
  }

  async performHealthChecks(): Promise<void> {
    this.logger.warn('Checking Health...');
    try {
      if (!this.pool)
        throw new Error(
          'Attempted to check health before pool initialization!',
        );
      await this.pool.query('SELECT 1');
      this.logger.log('Healthy.');
    } catch (err) {
      this.logger.error(
        `Health check failed, terminating. Code: ${String(ExitCode.DB_CONNECTION_ERROR)} (${ExitCodesDescription[ExitCode.DB_CONNECTION_ERROR]})`,
        err instanceof Error ? err.stack : String(err),
      );
      process.kill(process.pid, 'SIGTERM');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.debug('Closing...');
    if (this.pool) {
      this.logger.debug('Pool exists, attempting to end it...');
      await this.pool.end();
    }
    this.logger.debug('Destroyed.');
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    const id = randomUUID(),
      startMark = `query:${id}:start`,
      endMark = `query:${id}:end`;

    performance.mark(startMark);
    try {
      this.logger.debug(`Executing query [ID:${id}]: ${text}`, params);
      if (!this.pool)
        throw new Error(
          'Attempted to query database before pool initalization!',
        );
      return await this.pool.query<R>(text, params);
    } catch (error) {
      this.logger.error(
        `Query failed [ID:${id}]: ${text}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      performance.mark(endMark);
      const measure = performance.measure('db.query', startMark, endMark);
      this.logger.debug(
        `[PERF] Query [ID:${id}] took ${String(measure.duration)}ms`,
      );
      performance.clearMeasures(measure.name);
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    }
  }

  private readPassword(): string {
    try {
      const path = this.configService.getOrThrow<string>('DB_PASSWORD_FILE');
      return readFileSync(path, 'utf-8').trim();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      throw new Error(`Could not read DB password file: ${error}`, {
        cause: e,
      });
    }
  }
}
