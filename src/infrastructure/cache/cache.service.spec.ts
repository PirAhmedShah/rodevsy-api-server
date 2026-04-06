import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import * as redis from 'redis';
import * as fs from 'fs';
import { SilentLogger } from '@/common/utils';

jest.mock('redis', () => ({
  createClientPool: jest.fn(),
}));

jest.mock('fs');

interface MockPool {
  on: jest.Mock;
  connect: jest.Mock;
  ping: jest.Mock;
  close: jest.Mock;
}
describe('CacheService', () => {
  let configService: ConfigService, mockPool: MockPool, service: CacheService;

  const ENV: Record<string, string> = {
    CACHE_HOST: 'localhost',
    CACHE_PORT: '6379',
    CACHE_PASSWORD_FILE: '/fake/redis/pass.txt',
    CACHE_POOL_MIN_CONNECTIONS: '2',
    CACHE_POOL_MAX_CONNECTIONS: '10',
  };

  beforeEach(async () => {
    // Define the mock pool interface
    mockPool = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue('PONG'),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (redis.createClientPool as jest.Mock).mockReturnValue(mockPool);
    (fs.readFileSync as jest.Mock).mockReturnValue('mocked-redis-password');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
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

    service = module.get<CacheService>(CacheService);
    configService = module.get<ConfigService>(ConfigService);

    // Mock process.kill to prevent test runner from exiting
    jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit()', () => {
    it('should initialize the pool and pass health checks', async () => {
      await service.onModuleInit();

      expect(redis.createClientPool).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'redis://:mocked-redis-password@localhost:6379',
        }),
        {
          maximum: 10,
          minimum: 2,
        },
      );
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockPool.ping).toHaveBeenCalled();
      expect(service.pool).toBeDefined();
    });

    it('should kill process if health check (ping) fails', async () => {
      mockPool.ping.mockRejectedValueOnce(new Error('Redis Down'));

      await service.onModuleInit();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });

    it('should kill process when the pool emits an error event', async () => {
      let errorHandler: ((err: Error) => void) | undefined;
      mockPool.on.mockImplementation(
        (event: string, cb: ((err: Error) => void) | undefined) => {
          if (event === 'error') errorHandler = cb;
        },
      );

      await service.onModuleInit();

      expect(errorHandler).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      errorHandler!(new Error('Redis pool crash'));
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });

    it('should register an open event handler without throwing', async () => {
      let openHandler: (() => void) | undefined;
      mockPool.on.mockImplementation(
        (event: string, cb: (() => void) | undefined) => {
          if (event === 'open') openHandler = cb;
        },
      );

      await service.onModuleInit();

      expect(openHandler).toBeDefined();
      // Calling it should not throw
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        openHandler!();
      }).not.toThrow();
    });

    // --- FIX: Added the missing "it" block declaration here ---
    it('should throw if max or min connections are invalid', async () => {
      jest.spyOn(configService, 'getOrThrow').mockImplementation((key) => {
        if (key === 'CACHE_POOL_MAX_CONNECTIONS') return 'invalid';
        return ENV[key];
      });

      await expect(service.onModuleInit()).rejects.toThrow(
        'CACHE_POOL_MAX_CONNECTIONS or CACHE_POOL_MIN_CONNECTIONS is NaN.',
      );
    });
  });

  describe('execute()', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should wrap and execute a redis command successfully', async () => {
      const mockResult = 'OK',
        operation = jest.fn().mockResolvedValue(mockResult),
        result = await service.execute(operation);

      expect(result).toBe(mockResult);
      expect(operation).toHaveBeenCalledWith(mockPool);
    });

    it('should log and re-throw if the operation fails', async () => {
      const redisError = new Error(
          "READONLY You can't write against a read only replica",
        ),
        operation = jest.fn().mockRejectedValue(redisError);

      await expect(service.execute(operation)).rejects.toThrow(redisError);
    });

    it('should record performance metrics during execution', async () => {
      const markSpy = jest.spyOn(performance, 'mark'),
        measureSpy = jest.spyOn(performance, 'measure');

      await service.execute(async (client) => client.ping());

      expect(markSpy).toHaveBeenCalledWith(expect.stringContaining('cache:'));
      expect(measureSpy).toHaveBeenCalledWith(
        'cache.operation',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('onModuleDestroy()', () => {
    it('should gracefully close the pool if it exists', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(mockPool.close).toHaveBeenCalled();
    });

    it('should resolve silently if the pool was never initialized', async () => {
      service.pool = undefined;
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('readPassword()', () => {
    it('should throw an error if the password file cannot be read', () => {
      (fs.readFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('File not found');
      });

      // Accessing private method for a specific edge case check
      expect(() => {
        (service as unknown as { readPassword: () => void }).readPassword();
      }).toThrow(/Could not read CACHE password file/);
    });
  });
});
