import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as jose from 'jose';

import { JwtModule } from './jwt.module';
import { JwtService } from './jwt.service';
import { AccessToken, RefreshToken } from './jwt.entity';
import { JwtType, JwtAudience } from './jwt.enum';
import { SilentLogger } from '@/common/utils';

describe('JwtModule Integration', () => {
  let service: JwtService;

  // Define real paths on the actual file system
  const testKeysDir = path.join(__dirname, '.test-keys-temp');
  const privateKeyPath = path.join(testKeysDir, 'private.pem');
  const publicKeyPath = path.join(testKeysDir, 'public.pem');

  beforeAll(async () => {
    // 1. Setup REAL File System: Generate keys and write them to disk
    await fs.mkdir(testKeysDir, { recursive: true });

    const { publicKey, privateKey } = await jose.generateKeyPair('EdDSA', {
      extractable: true,
    });

    await fs.writeFile(privateKeyPath, await jose.exportPKCS8(privateKey));
    await fs.writeFile(publicKeyPath, await jose.exportSPKI(publicKey));

    // 2. Setup REAL ConfigModule instead of mocking ConfigService
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        // Boot up the real ConfigModule and inject our real paths
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true, // We inject variables directly for the test
          load: [
            () => ({
              JWT_ISSUER: 'int-test-issuer',
              JWT_AUDIENCE: JwtAudience.API,
              JWT_PRIVATE_FILE: privateKeyPath,
              JWT_PUBLIC_FILE: publicKeyPath,
            }),
          ],
        }),
        JwtModule,
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    service = moduleRef.get<JwtService>(JwtService);

    // 3. Trigger lifecycle hook so JwtService reads the REAL files from disk
    await service.onModuleInit();
  });

  afterAll(async () => {
    // 4. Cleanup: Delete the real files and folder from disk after tests finish
    await fs.rm(testKeysDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Integration: sign → verify round-trip
  // =========================================================================

  describe('round-trip sign → verify', () => {
    it('a signed access token round-trips through verify without error', async () => {
      const userId = 'rt-user-1',
        jti = 'rt-jti-1',
        token = AccessToken.create(userId, jti),
        jwt = await service.sign(token),
        result = await service.verify(jwt, JwtType.ACCESS);

      expect(result.payload.sub).toBe(userId);
      expect(result.payload.jti).toBe(jti);
      expect(result.payload.type).toBe(JwtType.ACCESS);
    });

    it('a signed refresh token round-trips through verify without error', async () => {
      const userId = 'rt-user-2',
        jti = 'rt-jti-2',
        token = RefreshToken.create(userId, jti),
        jwt = await service.sign(token),
        result = await service.verify(jwt, JwtType.REFRESH);

      expect(result.payload.sub).toBe(userId);
      expect(result.payload.jti).toBe(jti);
      expect(result.payload.type).toBe(JwtType.REFRESH);
    });

    it('access and refresh tokens are not interchangeable after signing', async () => {
      const accessToken = AccessToken.create('user-rt-3', 'jti-rt-3a'),
        refreshToken = RefreshToken.create('user-rt-3', 'jti-rt-3r'),
        accessJwt = await service.sign(accessToken),
        refreshJwt = await service.sign(refreshToken);

      await expect(service.verify(accessJwt, JwtType.REFRESH)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.verify(refreshJwt, JwtType.ACCESS)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
