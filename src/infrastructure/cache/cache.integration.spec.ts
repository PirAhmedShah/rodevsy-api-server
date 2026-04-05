import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';

import { CacheModule } from './cache.module';
import { CacheService } from './cache.service';
import { SilentLogger } from '@/common/utils';

describe('CacheModule Integration', () => {
  let service: CacheService;

  // Navigate up from src/infrastructure/cache to the project root, then into secrets/
  const realPasswordPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'secrets',
    'cache_password.secret',
  );

  const CACHE_HOST = process.env.CACHE_HOST ?? 'localhost';
  const CACHE_PORT = process.env.CACHE_PORT ?? '6379';

  beforeAll(async () => {
    // 1. Safely spy on process.kill (and cast variables to string for ESLint)
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      console.error(
        `[Test Safety] process.kill(${String(pid)}, ${String(signal)}) intercepted. Is your test Redis database running?`,
      );
      return true;
    });

    // 2. Setup REAL ConfigModule and inject our real paths and credentials
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              CACHE_HOST,
              CACHE_PORT,
              CACHE_PASSWORD_FILE: realPasswordPath,
              CACHE_POOL_MIN_CONNECTIONS: '1',
              CACHE_POOL_MAX_CONNECTIONS: '2',
            }),
          ],
        }),
        CacheModule,
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    service = moduleRef.get<CacheService>(CacheService);

    // 3. Trigger lifecycle hook
    await service.onModuleInit();
  });

  afterAll(async () => {
    // 4. Cleanup
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Integration: Real Cache Operations
  // =========================================================================

  describe('Real Redis Queries', () => {
    it('should successfully execute a basic PING (Health Check)', async () => {
      const result = await service.execute(async (client) => {
        return await client.ping();
      });

      expect(result).toBe('PONG');
    });

    it('should perform a full set, get, and delete lifecycle', async () => {
      const testKey = 'integration_test_key';
      const testValue = 'hello_redis';

      // 1. Set the value
      const setResult = await service.execute(async (client) => {
        return await client.set(testKey, testValue);
      });
      expect(setResult).toBe('OK');

      // 2. Get the value back and verify it matches
      const getResult = await service.execute(async (client) => {
        return await client.get(testKey);
      });
      expect(getResult).toBe(testValue);

      // 3. Delete the value to clean up
      const delResult = await service.execute(async (client) => {
        return await client.del(testKey);
      });
      expect(delResult).toBeGreaterThanOrEqual(1); // Returns number of keys removed

      // 4. Verify it was actually deleted
      const checkResult = await service.execute(async (client) => {
        return await client.get(testKey);
      });
      expect(checkResult).toBeNull();
    });
  });
});
