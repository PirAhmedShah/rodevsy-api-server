import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from './jwt.service';
import { AccessToken, RefreshToken } from './jwt.entity';
import { JwtAudience, JwtType } from './jwt.enum';
import * as fs from 'fs';
import * as jose from 'jose';
import { SilentLogger } from '@/common/utils';

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------

const ISSUER = 'test-issuer',
  AUDIENCE: JwtAudience = JwtAudience.API,
  ALG = 'EdDSA';

// ---------------------------------------------------------------------------
// Mocked Modules
// ---------------------------------------------------------------------------
jest.mock('fs');
const mockedFs = jest.mocked(fs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateEdDSAKeyPair() {
  const { publicKey, privateKey } = await jose.generateKeyPair(ALG, {
      extractable: true,
    }),
    privatePem = await jose.exportPKCS8(privateKey),
    publicPem = await jose.exportSPKI(publicKey);
  return { publicKey, privateKey, privatePem, publicPem };
}

/** Signs a raw token string using a given private PEM (bypasses JwtService). */
async function signRaw(
  payload: Record<string, unknown>,
  privatePem: string,
  opts: {
    issuer?: string;
    audience?: string;
    jti?: string;
    subject?: string;
    expiresIn?: string;
  } = {},
): Promise<string> {
  const privateKey = await jose.importPKCS8(privatePem, ALG);
  let builder = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt();

  if (opts.issuer) builder = builder.setIssuer(opts.issuer);
  if (opts.audience) builder = builder.setAudience(opts.audience);
  if (opts.jti) builder = builder.setJti(opts.jti);
  if (opts.subject) builder = builder.setSubject(opts.subject);
  if (opts.expiresIn) builder = builder.setExpirationTime(opts.expiresIn);

  return builder.sign(privateKey);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JwtService', () => {
  let privatePem: string,
    publicKey: jose.KeyObject,
    publicPem: string,
    service: JwtService;

  // Env vars consumed by onModuleInit
  const ENV: Record<string, string> = {
    JWT_ISSUER: ISSUER,
    JWT_AUDIENCE: AUDIENCE,
    JWT_PRIVATE_FILE: './fake/private.pem',
    JWT_PUBLIC_FILE: './fake/public.pem',
  };

  beforeAll(async () => {
    // Note: privateKey is generated but intentionally not extracted/used in the tests to satisfy ESLint
    const keys = await generateEdDSAKeyPair();
    privatePem = keys.privatePem;
    publicKey = keys.publicKey;
    publicPem = keys.publicPem;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key in ENV) return ENV[key];
              throw new Error(`ConfigService.getOrThrow: unknown key "${key}"`);
            },
          },
        },
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    service = module.get<JwtService>(JwtService);

    // ESLint fix: Removed unused 'options' argument
    mockedFs.readFileSync.mockImplementation((path) => {
      switch (path) {
        case ENV.JWT_PUBLIC_FILE:
          return publicPem;
        case ENV.JWT_PRIVATE_FILE:
          return privatePem;
        default:
          throw new Error(`Invalid fs.readFileSync path!`);
      }
    });
    await service.onModuleInit();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Instantiation & initialisation
  // =========================================================================

  describe('instantiation', () => {
    it('should be defined after module initialisation', () => {
      expect(service).toBeDefined();
    });
  });

  // =========================================================================
  // Sign()
  // =========================================================================

  describe('sign()', () => {
    it('should return a non-empty JWT string for an AccessToken', async () => {
      const token = AccessToken.create('user-1', 'jti-access-1'),
        jwt = await service.sign(token);

      expect(typeof jwt).toBe('string');
      expect(jwt.split('.').length).toBe(3); // Header.payload.signature
    });

    it('should return a non-empty JWT string for a RefreshToken', async () => {
      const token = RefreshToken.create('user-2', 'jti-refresh-1'),
        jwt = await service.sign(token);

      expect(jwt.split('.').length).toBe(3);
    });

    it('should embed the correct sub claim', async () => {
      const userId = 'user-sub-test',
        token = AccessToken.create(userId, 'jti-sub'),
        jwt = await service.sign(token),
        { payload } = await jose.jwtVerify(jwt, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
        });

      expect(payload.sub).toBe(userId);
    });

    it('should embed the correct jti claim', async () => {
      const jti = 'unique-jti-xyz',
        token = AccessToken.create('user-3', jti),
        jwt = await service.sign(token),
        { payload } = await jose.jwtVerify(jwt, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
        });
      expect(payload.jti).toBe(jti);
    });

    it('should embed the correct type claim for access tokens', async () => {
      const token = AccessToken.create('user-4', 'jti-type-access'),
        jwt = await service.sign(token),
        { payload } = await jose.jwtVerify(jwt, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
        });
      expect(payload.type).toBe(JwtType.ACCESS);
    });

    it('should embed the correct type claim for refresh tokens', async () => {
      const token = RefreshToken.create('user-5', 'jti-type-refresh'),
        jwt = await service.sign(token),
        { payload } = await jose.jwtVerify(jwt, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
        });
      expect(payload.type).toBe(JwtType.REFRESH);
    });

    it('should embed the correct issuer claim', async () => {
      const token = AccessToken.create('user-6', 'jti-iss'),
        jwt = await service.sign(token),
        { payload } = await jose.jwtVerify(jwt, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
        });
      expect(payload.iss).toBe(ISSUER);
    });

    it('should embed the correct audience claim', async () => {
      const token = AccessToken.create('user-7', 'jti-aud'),
        jwt = await service.sign(token),
        { payload } = await jose.jwtVerify(jwt, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
        });
      expect(payload.aud).toBe(AUDIENCE);
    });

    it('should embed an expiration time matching the token entity', async () => {
      const token = AccessToken.create('user-8', 'jti-exp'),
        jwt = await service.sign(token),
        { payload } = await jose.jwtVerify(jwt, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'JWT',
        });
      expect(payload.exp).toBe(token.expiresAt);
    });

    it('should set the typ header to JWT', async () => {
      const token = AccessToken.create('user-9', 'jti-typ'),
        jwt = await service.sign(token),
        decoded = jose.decodeProtectedHeader(jwt);
      expect(decoded.typ).toBe('JWT');
    });

    it('should set the alg header to EdDSA', async () => {
      const token = AccessToken.create('user-10', 'jti-alg'),
        jwt = await service.sign(token),
        decoded = jose.decodeProtectedHeader(jwt);
      expect(decoded.alg).toBe(ALG);
    });

    it('should produce unique tokens for unique jti values', async () => {
      const t1 = AccessToken.create('user-11', 'jti-unique-1'),
        t2 = AccessToken.create('user-11', 'jti-unique-2'),
        [jwt1, jwt2] = await Promise.all([service.sign(t1), service.sign(t2)]);
      expect(jwt1).not.toBe(jwt2);
    });
  });

  // =========================================================================
  // Verify() - happy paths
  // =========================================================================

  describe('verify() - valid tokens', () => {
    it('should successfully verify a freshly signed access token', async () => {
      const token = AccessToken.create('user-v1', 'jti-v-access'),
        jwt = await service.sign(token);

      await expect(service.verify(jwt, JwtType.ACCESS)).resolves.toBeDefined();
    });

    it('should successfully verify a freshly signed refresh token', async () => {
      const token = RefreshToken.create('user-v2', 'jti-v-refresh'),
        jwt = await service.sign(token);

      await expect(service.verify(jwt, JwtType.REFRESH)).resolves.toBeDefined();
    });

    it('should return a JWTVerifyResult containing the payload', async () => {
      const userId = 'user-v3',
        jti = 'jti-payload-check',
        token = AccessToken.create(userId, jti),
        jwt = await service.sign(token),
        result = await service.verify(jwt, JwtType.ACCESS);

      expect(result.payload.sub).toBe(userId);
      expect(result.payload.jti).toBe(jti);
      expect(result.payload.type).toBe(JwtType.ACCESS);
    });
  });

  // =========================================================================
  // Verify() - expired token
  // =========================================================================

  describe('verify() - expired token', () => {
    it('should throw UnauthorizedException with "Token expired" for an expired JWT', async () => {
      // Craft a token that expired 1 second ago
      const expiredJwt = await signRaw({ type: JwtType.ACCESS }, privatePem, {
        issuer: ISSUER,
        audience: AUDIENCE,
        jti: 'jti-expired',
        subject: 'user-expired',
        expiresIn: '-1s',
      });

      await expect(service.verify(expiredJwt, JwtType.ACCESS)).rejects.toThrow(
        new UnauthorizedException('Token expired'),
      );
    });
  });

  // =========================================================================
  // Verify() - wrong purpose / type mismatch
  // =========================================================================

  describe('verify() - token purpose mismatch', () => {
    it('should throw ForbiddenException when an access token is used as a refresh token', async () => {
      const token = AccessToken.create('user-mismatch', 'jti-mismatch-1'),
        jwt = await service.sign(token);

      await expect(service.verify(jwt, JwtType.REFRESH)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException with "Token used for wrong purpose" message', async () => {
      const token = AccessToken.create('user-mismatch2', 'jti-mismatch-2'),
        jwt = await service.sign(token);

      await expect(service.verify(jwt, JwtType.REFRESH)).rejects.toThrow(
        'Token used for wrong purpose',
      );
    });

    it('should throw ForbiddenException when a refresh token is used as an access token', async () => {
      const token = RefreshToken.create('user-mismatch3', 'jti-mismatch-3'),
        jwt = await service.sign(token);

      await expect(service.verify(jwt, JwtType.ACCESS)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // =========================================================================
  // Verify() - invalid / tampered tokens
  // =========================================================================

  describe('verify() - invalid tokens', () => {
    it('should throw UnauthorizedException for a completely invalid string', async () => {
      await expect(service.verify('not.a.jwt', JwtType.ACCESS)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a tampered signature', async () => {
      const token = AccessToken.create('user-tamper', 'jti-tamper'),
        jwt = await service.sign(token),
        parts = jwt.split('.'),
        // Replace the middle of the signature with "tampered"
        // This is much more reliable than changing one character at the end
        signature = parts[2];
      parts[2] = `A${signature.substring(10)}`;
      const tampered = parts.join('.');

      await expect(service.verify(tampered, JwtType.ACCESS)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a token signed with a different key', async () => {
      const { privatePem: otherPrivatePem } = await generateEdDSAKeyPair(), // Extractable: true is set inside helper
        foreignJwt = await signRaw({ type: JwtType.ACCESS }, otherPrivatePem, {
          issuer: ISSUER,
          audience: AUDIENCE,
          jti: 'jti-foreign',
          subject: 'user-foreign',
          expiresIn: '15m',
        });

      await expect(service.verify(foreignJwt, JwtType.ACCESS)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a token with wrong issuer', async () => {
      const wrongIssuerJwt = await signRaw(
        { type: JwtType.ACCESS },
        privatePem,
        {
          issuer: 'wrong-issuer',
          audience: AUDIENCE,
          jti: 'jti-iss-wrong',
          subject: 'user-iss',
          expiresIn: '15m',
        },
      );

      await expect(
        service.verify(wrongIssuerJwt, JwtType.ACCESS),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for a token with wrong audience', async () => {
      const wrongAudJwt = await signRaw({ type: JwtType.ACCESS }, privatePem, {
        issuer: ISSUER,
        audience: 'wrong-audience',
        jti: 'jti-aud-wrong',
        subject: 'user-aud',
        expiresIn: '15m',
      });

      await expect(service.verify(wrongAudJwt, JwtType.ACCESS)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a token with wrong typ header', async () => {
      const privateKey = await jose.importPKCS8(privatePem, ALG),
        wrongTypJwt = await new jose.SignJWT({ type: JwtType.ACCESS })
          .setProtectedHeader({ alg: ALG, typ: 'at+JWT' }) // Different typ
          .setSubject('user-typ')
          .setAudience(AUDIENCE)
          .setIssuer(ISSUER)
          .setJti('jti-typ-wrong')
          .setIssuedAt()
          .setExpirationTime('15m')
          .sign(privateKey);

      await expect(service.verify(wrongTypJwt, JwtType.ACCESS)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a token missing the exp claim', async () => {
      const privateKey = await jose.importPKCS8(privatePem, ALG),
        noExpJwt = await new jose.SignJWT({ type: JwtType.ACCESS })
          .setProtectedHeader({ alg: ALG, typ: 'JWT' })
          .setSubject('user-noexp')
          .setAudience(AUDIENCE)
          .setIssuer(ISSUER)
          .setJti('jti-noexp')
          .setIssuedAt()
          // Deliberately no .setExpirationTime()
          .sign(privateKey);

      await expect(service.verify(noExpJwt, JwtType.ACCESS)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a plain string that looks like a JWT', async () => {
      const fakeJwt = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.invalidsig';

      await expect(service.verify(fakeJwt, JwtType.ACCESS)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // Verify() - error message specificity
  // =========================================================================

  describe('verify() - UnauthorizedException message specificity', () => {
    it('expired tokens use "Token expired" not the generic message', async () => {
      const expiredJwt = await signRaw({ type: JwtType.ACCESS }, privatePem, {
        issuer: ISSUER,
        audience: AUDIENCE,
        jti: 'jti-msg-exp',
        subject: 'user-msg',
        expiresIn: '-1s',
      });

      await expect(service.verify(expiredJwt, JwtType.ACCESS)).rejects.toThrow(
        'Token expired',
      );
    });

    it('invalid tokens use "Invalid token" message', async () => {
      await expect(
        service.verify('invalid.token.here', JwtType.ACCESS),
      ).rejects.toThrow('Invalid token');
    });

    it('should use "Token verification failed" for unknown non-jose errors', async () => {
      // @ts-expect-error: intentional to hit catch all error
      await expect(service.verify(undefined, JwtType.ACCESS)).rejects.toThrow(
        'Token verification failed',
      );
    });
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

      // Cross-verify must fail
      await expect(service.verify(accessJwt, JwtType.REFRESH)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.verify(refreshJwt, JwtType.ACCESS)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
