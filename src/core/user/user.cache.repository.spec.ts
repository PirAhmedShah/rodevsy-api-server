import { Test, TestingModule } from '@nestjs/testing';
import { UserCacheRepository } from './user.cache.repository';
import { CacheService } from '@/infrastructure/cache/cache.service';
import { RefreshToken } from '@/infrastructure/jwt/jwt.entity';
import { JwtAudience, JwtType } from '@/infrastructure/jwt/jwt.enum';
import { SilentLogger } from '@/common/utils';

describe('UserCacheRepository', () => {
  let cacheService: CacheService, repository: UserCacheRepository;

  const mockMulti = {
      zRemRangeByScore: jest.fn().mockReturnThis(),
      zAdd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    },
    mockRedisClient = {
      multi: jest.fn(() => mockMulti),
      zScore: jest.fn(),
      zRem: jest.fn(),
    },
    mockCacheService = {
      execute: jest.fn((fn) => {
        return fn(mockRedisClient);
      }),
    };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserCacheRepository,
        { provide: CacheService, useValue: mockCacheService },
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    repository = module.get<UserCacheRepository>(UserCacheRepository);
    cacheService = module.get<CacheService>(CacheService);
    jest.clearAllMocks();
  });

  const mockToken = new RefreshToken(
    'user123',
    'jti-456',
    JwtType.REFRESH,
    JwtAudience.API,
    Math.floor(Date.now() / 1000) + 1000,
  );

  describe('storeRefreshToken()', () => {
    it('should use a transaction to cleanup and store the token', async () => {
      await repository.storeRefreshToken(mockToken);

      expect(mockMulti.zRemRangeByScore).toHaveBeenCalled();
      expect(mockMulti.zAdd).toHaveBeenCalledWith('auth:jti:user123', {
        score: mockToken.expiresAt,
        value: mockToken.jti,
      });
      expect(mockMulti.exec).toHaveBeenCalled();
    });
  });

  describe('isTokenStored()', () => {
    it('should return true if token exists and is not expired', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 5000;
      mockRedisClient.zScore.mockResolvedValueOnce(futureExpiry);

      const result = await repository.isTokenStored(mockToken);
      expect(result).toBe(true);
    });

    it('should return false if token is not found in Redis', async () => {
      mockRedisClient.zScore.mockResolvedValueOnce(null);

      const result = await repository.isTokenStored(mockToken);
      expect(result).toBe(false);
    });

    it('should return false if score exists but is in the past (expired)', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100;
      mockRedisClient.zScore.mockResolvedValueOnce(pastExpiry);

      const result = await repository.isTokenStored(mockToken);
      expect(result).toBe(false);
    });
  });

  describe('revokeRefreshToken()', () => {
    it('should remove the specific JTI using lowercase zRem', async () => {
      mockRedisClient.zRem.mockResolvedValueOnce(1);

      const result = await repository.revokeRefreshToken(mockToken);

      expect(result).toBe(1);
      expect(mockRedisClient.zRem).toHaveBeenCalledWith(
        'auth:jti:user123',
        'jti-456',
      );
    });

    it('should return 0 when the token does not exist to remove', async () => {
      mockRedisClient.zRem.mockResolvedValueOnce(0);

      const result = await repository.revokeRefreshToken(mockToken);
      expect(result).toBe(0);
    });
  });
});
