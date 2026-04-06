/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DbService } from './db.service';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import * as fs from 'fs';
import { SilentLogger } from '@/common/utils';

jest.mock('pg', () => {
  const mPool = {
    on: jest.fn().mockReturnThis(),
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});
jest.mock('fs');

/** Cast a partial pg result shape to QueryResult without full field list */
function asQueryResult<R extends QueryResultRow>(
  partial: Partial<QueryResult<R>>,
): QueryResult<R> {
  return partial as unknown as QueryResult<R>;
}

describe('DbService', () => {
  let configService: ConfigService;
  let mockPool: jest.Mocked<Pool>;
  let service: DbService;

  const ENV: Record<string, string> = {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'user',
    DB_NAME: 'test_db',
    DB_PASSWORD_FILE: '/fake/path/pass.txt',
    DB_POOL_MIN_CONNECTIONS: '2',
    DB_POOL_MAX_CONNECTIONS: '10',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => ENV[key]),
          },
        },
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    service = module.get<DbService>(DbService);
    configService = module.get<ConfigService>(ConfigService);

    mockPool = new Pool() as jest.Mocked<Pool>;

    jest.spyOn(process, 'kill').mockImplementation(() => true as never);
    (fs.readFileSync as jest.Mock).mockReturnValue('super-secret-password');
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit()', () => {
    it('should initialize the pool and perform a successful health check', async () => {
      const poolQuery = mockPool.query as jest.Mock;
      poolQuery.mockResolvedValueOnce(asQueryResult({ rows: [{ '1': 1 }] }));

      await service.onModuleInit();

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: ENV.DB_HOST,
          password: 'super-secret-password',
          min: 2,
          max: 10,
        }),
      );
      expect(poolQuery).toHaveBeenCalledWith('SELECT 1');
      expect(service.pool).toBeDefined();
    });

    it('should kill process if health check fails', async () => {
      const poolQuery = mockPool.query as jest.Mock;
      poolQuery.mockRejectedValueOnce(new Error('Connection Refused'));

      await service.onModuleInit();

      expect(process).toHaveProperty('kill');
      expect(process.kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });

    it('should throw error if numeric config values are NaN', async () => {
      jest.spyOn(configService, 'getOrThrow').mockImplementation((key) => {
        if (key === 'DB_PORT') return 'not-a-number';
        return ENV[key as string];
      });

      await expect(service.onModuleInit()).rejects.toThrow(
        'DB_POOL_MAX_CONNECTIONS, DB_POOL_MIN_CONNECTIONS, or DB_PORT is NaN.',
      );
    });
  });

  describe('query()', () => {
    beforeEach(async () => {
      const poolQuery = mockPool.query as jest.Mock;
      poolQuery.mockResolvedValue(asQueryResult({ rows: [] }));
      await service.onModuleInit();
    });

    it('should execute a query and return results', async () => {
      const poolQuery = mockPool.query as jest.Mock;
      const mockResult = asQueryResult({ rows: [{ id: 1, name: 'Test' }] });
      poolQuery.mockResolvedValueOnce(mockResult);

      const result = await service.query(
        'SELECT * FROM users WHERE id = $1',
        [1],
      );

      expect(result).toBe(mockResult);
      expect(poolQuery).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = $1',
        [1],
      );
    });

    it('should log and re-throw error if query fails', async () => {
      const poolQuery = mockPool.query as jest.Mock;
      const dbError = new Error('Syntax Error');
      poolQuery.mockRejectedValueOnce(dbError);

      await expect(service.query('INVALID SQL')).rejects.toThrow(dbError);
    });

    it('should record performance marks', async () => {
      const markSpy = jest.spyOn(performance, 'mark');
      const measureSpy = jest.spyOn(performance, 'measure');

      await service.query('SELECT 1');

      expect(markSpy).toHaveBeenCalledWith(expect.stringContaining('query:'));
      expect(measureSpy).toHaveBeenCalledWith(
        'db.query',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('pool error event handler', () => {
    it('should kill process when pool emits an error event', async () => {
      let errorHandler: ((err: Error) => void) | undefined;

      (mockPool.on as jest.Mock).mockImplementation(
        (event: string, cb: (err: Error) => void) => {
          if (event === 'error') errorHandler = cb;
          return mockPool;
        },
      );

      const poolQuery = mockPool.query as jest.Mock;
      poolQuery.mockResolvedValue(asQueryResult({ rows: [{ '1': 1 }] }));

      await service.onModuleInit();

      if (!errorHandler) throw new Error('Error handler not assigned');

      errorHandler(new Error('Pool crashed'));
      expect(process.kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });
  });

  describe('readPassword() - error path', () => {
    it('should throw a descriptive error if the password file cannot be read', async () => {
      (fs.readFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('ENOENT: no such file');
      });

      await expect(service.onModuleInit()).rejects.toThrow(
        /Could not read DB password file/,
      );
    });
  });

  describe('performHealthChecks() - non-Error thrown value', () => {
    it('should handle string thrown during health check and still kill process', async () => {
      const poolQuery = mockPool.query as jest.Mock;
      poolQuery.mockRejectedValueOnce('string error');

      await service.onModuleInit();

      expect(process.kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });
  });

  describe('onModuleDestroy()', () => {
    it('should close the pool if it exists', async () => {
      const poolQuery = mockPool.query as jest.Mock;
      poolQuery.mockResolvedValue(asQueryResult({ rows: [] }));
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should not throw if pool is not initialized', async () => {
      service.pool = undefined;
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
