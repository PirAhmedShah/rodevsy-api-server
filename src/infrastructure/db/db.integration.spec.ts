import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';

import { DbModule } from './db.module';
import { DbService } from './db.service';
import { SilentLogger } from '@/common/utils';

interface TestUserRow {
  id: number;
  name: string;
}

describe('DbModule (True Integration)', () => {
  let service: DbService;

  const realPasswordPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'dummy',
    'secrets',
    'db_password.secret',
  );

  const DB_HOST = process.env.DB_HOST ?? 'localhost';
  const DB_PORT = process.env.DB_PORT ?? '5432';
  const DB_USER = process.env.DB_USER ?? 'postgres';
  const DB_NAME = process.env.DB_NAME ?? 'dev';

  beforeAll(async () => {
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      console.error(
        `[Test Safety] process.kill(${String(pid)}, ${String(signal)}) intercepted. Is your test PostgreSQL database running?`,
      );
      return true;
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DB_HOST,
              DB_PORT,
              DB_USER,
              DB_NAME,
              DB_PASSWORD_FILE: realPasswordPath,
              DB_POOL_MIN_CONNECTIONS: '1',
              DB_POOL_MAX_CONNECTIONS: '2',
            }),
          ],
        }),
        DbModule,
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    service = moduleRef.get<DbService>(DbService);

    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Integration: Real Database Operations
  // =========================================================================

  describe('Real Database Queries', () => {
    it('should successfully execute a basic SELECT 1 query (Health Check)', async () => {
      const result = await service.query<{ test_val: number }>(
        'SELECT 1 AS test_val',
      );
      expect(result.rows[0].test_val).toBe(1);
    });

    it('should perform a full DDL and DML cycle (Create, Insert, Select, Drop)', async () => {
      const tableName = 'int_test_users_table';

      // Create a temporary testing table
      await service.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) NOT NULL
        );
      `);

      // Insert data using parameterized queries (Typed with TestUserRow)
      const insertResult = await service.query<TestUserRow>(
        `INSERT INTO ${tableName} (name) VALUES ($1) RETURNING *;`,
        ['Integration Tester'],
      );

      expect(insertResult.rows[0].name).toBe('Integration Tester');
      expect(insertResult.rows[0].id).toBeDefined();

      // Select data to verify persistence (Typed with TestUserRow)
      const selectResult = await service.query<TestUserRow>(
        `SELECT * FROM ${tableName} WHERE name = $1`,
        ['Integration Tester'],
      );

      expect(selectResult.rows).toHaveLength(1);
      expect(selectResult.rows[0].name).toBe('Integration Tester');

      // Drop table to leave the database perfectly clean
      await service.query(`DROP TABLE ${tableName};`);
    });

    it('should throw an error for malformed SQL', async () => {
      await expect(
        service.query('SELECT * FROM TABLE_THAT_DOES_NOT_EXIST'),
      ).rejects.toThrow();
    });
  });
});
