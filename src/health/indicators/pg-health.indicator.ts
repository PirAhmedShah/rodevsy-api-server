import { Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PoolClient } from 'pg';
import { DbService } from 'src/db/db.service';

interface PgStatsQueryResult {
  totalConnections: string;
  activeQueries: string;
  localConnections: string;
  maxConnections: string;
}

@Injectable()
export class PgHealthIndicator {
  private readonly checkKey = 'postgresql';
  // 1. Initialize the Logger
  private readonly logger = new Logger(PgHealthIndicator.name);

  constructor(
    private readonly dbService: DbService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    let client: PoolClient | null = null;
    try {
      client = await this.dbService.pool.connect();

      const statsRes = await client.query<PgStatsQueryResult>(`
        SELECT 
            COUNT(pid) AS "totalConnections",
            SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS "activeQueries",
            SUM(CASE WHEN client_addr IS NULL THEN 1 ELSE 0 END) AS "localConnections",
            current_setting('max_connections')::int::text AS "maxConnections"
        FROM pg_stat_activity
        WHERE datname = current_database()
        AND usename = current_user
      `);

      const stats = statsRes.rows[0];

      // Parse stats (Postgres COUNT/SUM often returns strings in node-postgres)
      const totalConnections = parseInt(stats.totalConnections, 10);
      const activeQueries = parseInt(stats.activeQueries, 10);
      const maxConnections = parseInt(stats.maxConnections, 10);
      const usagePercent =
        ((totalConnections / maxConnections) * 100).toFixed(2) + '%';

      // 3. Optional: Log status only if it's getting dangerously high (warn level)
      if (totalConnections > maxConnections * 0.8) {
        this.logger.warn(`High DB Connection Usage: ${usagePercent}`);
      }

      return this.healthIndicatorService.check(this.checkKey).up({
        poolTotal: this.dbService.pool.totalCount,
        poolIdle: this.dbService.pool.idleCount,
        poolWaiting: this.dbService.pool.waitingCount,

        dbTotalConnections: totalConnections,
        dbActiveQueries: activeQueries,
        dbMaxConnections: maxConnections,

        connectionUsagePercent: usagePercent,
      });
    } catch (e) {
      // 4. Log errors properly with stack trace
      this.logger.error(
        'PostgreSQL health check failed',
        e instanceof Error ? e.stack : e,
      );

      return this.healthIndicatorService.check(this.checkKey).down({
        message: 'PostgreSQL connection failed.',
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (client) client.release();
    }
  }
}
