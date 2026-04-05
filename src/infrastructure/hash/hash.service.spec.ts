import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { HashService } from './hash.service';
import { SilentLogger } from '@/common/utils';

jest.mock('argon2');
describe('HashService', () => {
  let service: HashService;
  const mockedArgon2 = jest.mocked(argon2);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HashService],
    })
      .setLogger(SilentLogger)
      .compile();

    service = module.get<HashService>(HashService);

    // Clear mocks between tests to ensure clean call counters
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // =========================================================================
  // Hash()
  // =========================================================================

  describe('hash()', () => {
    const fakeHash = '$argon2id$v=19$m=32768,t=3,p=1$somesalt$somehash',
      password = 'raw-password-123';

    it('should call argon2.hash with the correct security parameters', async () => {
      mockedArgon2.hash.mockResolvedValue(fakeHash);

      const result = await service.hash(password);

      expect(result).toBe(fakeHash);
      expect(mockedArgon2.hash).toHaveBeenCalledWith(password, {
        type: argon2.argon2id,
        memoryCost: 32768,
        timeCost: 3,
        parallelism: 1,
      });
    });

    it('should throw InternalServerErrorException when argon2.hash fails', async () => {
      // Simulate a low-level argon2 error (e.g., memory allocation failed)
      mockedArgon2.hash.mockRejectedValue(new Error('Argon2 internal error'));

      await expect(service.hash(password)).rejects.toThrow(
        InternalServerErrorException,
      );

      await expect(service.hash(password)).rejects.toThrow(
        'Error securing credentials',
      );
    });
  });

  // =========================================================================
  // Verify()
  // =========================================================================

  describe('verify()', () => {
    const password = 'raw-password-123',
      storedHash = '$argon2id$v=19$m=32768,t=3,p=1$somesalt$somehash';

    it('should return true when argon2.verify returns true', async () => {
      mockedArgon2.verify.mockResolvedValue(true);

      const result = await service.verify(storedHash, password);

      expect(result).toBe(true);
      expect(mockedArgon2.verify).toHaveBeenCalledWith(storedHash, password);
    });

    it('should return false when argon2.verify returns false', async () => {
      mockedArgon2.verify.mockResolvedValue(false);

      const result = await service.verify(storedHash, password);

      expect(result).toBe(false);
    });

    it('should return false and catch the error if argon2.verify throws', async () => {
      // This covers malformed hashes or library-level issues
      mockedArgon2.verify.mockRejectedValue(new Error('Verification failed'));

      const result = await service.verify(storedHash, password);

      expect(result).toBe(false);
    });
  });
});
