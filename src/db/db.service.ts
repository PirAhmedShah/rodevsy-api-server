import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { Pool, QueryConfigValues, QueryResult, QueryResultRow } from 'pg';
import { ExitCode, ExitCodesDescription } from 'src/enums';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  pool: Pool;

  constructor(private readonly configService: ConfigService) {
    this.logger.debug('Constructed.');
  }

  async onModuleInit() {
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

    // await to ensure health check completes before app starts
    await this.performHealthChecks();

    this.logger.debug('Initialized.');
  }

  async performHealthChecks() {
    this.logger.warn('Checking Health...');
    try {
      await this.pool.query('SELECT 1');
      this.logger.log('Healthy.');
    } catch (err) {
      this.logger.error(
        `Health check failed, terminating. Code: ${ExitCode.DB_CONNECTION_ERROR} (${ExitCodesDescription[ExitCode.DB_CONNECTION_ERROR]})`,
        err instanceof Error ? err.stack : String(err),
      );
      process.kill(process.pid, 'SIGTERM');
    }
  }

  async onModuleDestroy() {
    this.logger.debug('Closing...');
    if (this.pool) {
      this.logger.debug('Pool exists, attempting to end it...');
      await this.pool.end();
    }
    this.logger.debug('Destroyed.');
  }

  async query<R extends QueryResultRow = any, I extends any[] = any[]>(
    text: string,
    params?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>> {
    const id = randomUUID();
    const startMark = `query:${id}:start`;
    const endMark = `query:${id}:end`;

    performance.mark(startMark);
    try {
      this.logger.debug(`Executing query [ID:${id}]: ${text}`, params);
      return await this.pool.query<R, I>(text, params);
    } catch (error) {
      this.logger.error(
        `Query failed [ID:${id}]: ${text}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      performance.mark(endMark);
      const measure = performance.measure('db.query', startMark, endMark);
      this.logger.debug(`[PERF] Query [ID:${id}] took ${measure.duration}ms`);
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
      throw new Error(`Could not read DB password file: ${String(e)}`);
    }
  }
}
