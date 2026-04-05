import { Test, TestingModule } from '@nestjs/testing';
import { HashModule } from './hash.module';
import { HashService } from './hash.service';
import { SilentLogger } from '@/common/utils';

describe('HashModule Integration', () => {
  let service: HashService;

  beforeAll(async () => {
    // 1. Boot up the real module (No mocks, no config files needed)
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [HashModule],
    })
      .setLogger(SilentLogger)
      .compile();

    service = moduleRef.get<HashService>(HashService);
  });

  // =========================================================================
  // Integration: Real Cryptographic Operations
  // =========================================================================

  describe('Real Argon2 Operations', () => {
    it('should generate a real, valid Argon2id hash', async () => {
      const rawPassword = 'integration-secret-password';
      const hash = await service.hash(rawPassword);

      // Verify the hash is actually generated and formatted as Argon2id
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('should successfully verify a correct password against its generated hash', async () => {
      const rawPassword = 'correct-horse-battery-staple';

      // Hash it for real
      const hash = await service.hash(rawPassword);

      // Verify it for real
      const isValid = await service.verify(hash, rawPassword);
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect password against a generated hash', async () => {
      const rawPassword = 'my-real-password';
      const wrongPassword = 'my-wrong-password';

      const hash = await service.hash(rawPassword);

      const isValid = await service.verify(hash, wrongPassword);
      expect(isValid).toBe(false);
    });

    it('should safely return false when verifying a malformed hash string (simulating database corruption)', async () => {
      // Argon2 throws an internal error if the hash string is malformed.
      // We want to ensure our execute/try-catch wrapper catches it and returns false safely.
      const malformedHash = '$argon2id$v=19$m=32768,t=3,p=1$bad-salt$bad-hash';

      const isValid = await service.verify(malformedHash, 'any-password');
      expect(isValid).toBe(false);
    });
  });
});
