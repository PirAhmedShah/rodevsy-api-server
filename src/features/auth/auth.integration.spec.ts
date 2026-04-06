import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as path from 'path';

import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { DbService } from '@/infrastructure/db/db.service';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto } from './dtos/login.dto';
import { UserType, UserGender } from '@/core/user/user.enum';
import { SilentLogger } from '@/common/utils';

interface DbUserRow {
  id: string;
  username: string;
  hashed_password: string;
}

describe('AuthModule Integration', () => {
  let app: TestingModule;
  let authService: AuthService;
  let dbService: DbService;

  // Generate unique credentials for this test run to prevent DB unique constraint collisions
  const uniqueId = Date.now().toString();
  const testUsername = `inttestuser${uniqueId}`;
  const testEmail = `inttest${uniqueId}@example.com`;
  const testPassword = 'StrongPassword123!';

  const secretsDir = path.join(__dirname, '..', '..', '..', 'dummy', 'secrets');

  beforeAll(async () => {
    //spy on process.kill
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      console.error(
        `[Test Safety] process.kill(${String(pid)}, ${String(signal)}) intercepted. Are your Docker DB/Redis containers running?`,
      );
      return true;
    });

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'development',
              DB_HOST: process.env.DB_HOST ?? 'localhost',
              DB_PORT: process.env.DB_PORT ?? '5432',
              DB_USER: process.env.DB_USER ?? 'postgres',
              DB_NAME: process.env.DB_NAME ?? 'dev',
              DB_PASSWORD_FILE: path.join(secretsDir, 'db_password.secret'),
              DB_POOL_MIN_CONNECTIONS: '1',
              DB_POOL_MAX_CONNECTIONS: '5',
              CACHE_HOST: process.env.CACHE_HOST ?? 'localhost',
              CACHE_PORT: process.env.CACHE_PORT ?? '6379',
              CACHE_PASSWORD_FILE: path.join(
                secretsDir,
                'cache_password.secret',
              ),
              CACHE_POOL_MIN_CONNECTIONS: '1',
              CACHE_POOL_MAX_CONNECTIONS: '5',
              JWT_ISSUER: 'int-test-issuer',
              JWT_AUDIENCE: 'API',
              JWT_PRIVATE_FILE: path.join(secretsDir, 'jwt_private.pem'),
              JWT_PUBLIC_FILE: path.join(secretsDir, 'jwt_public.pem'),
            }),
          ],
        }),
        AuthModule,
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    await app.init();

    authService = app.get<AuthService>(AuthService);
    dbService = app.get<DbService>(DbService);
  });

  afterAll(async () => {
    await app.close();

    jest.restoreAllMocks();
  });

  // =========================================================================
  // Integration: Full Authentication Lifecycle
  // =========================================================================

  describe('Full Authentication Lifecycle', () => {
    let savedRefreshToken: string;

    it('1. Should successfully sign up a new user and hash the password', async () => {
      const signupDto: SignupDto = {
        email: testEmail,
        password: testPassword,
        dob: new Date('1990-01-01'),
        username: testUsername,
        firstName: 'Integration',
        lastName: 'Tester',
        type: UserType.CLIENT,
        gender: UserGender.MALE,
      };

      await authService.signup(signupDto);

      // Verify the results directly against the real database table
      const dbResult = await dbService.query<DbUserRow>(
        'SELECT id, username, hashed_password FROM users WHERE username = $1',
        [testUsername],
      );
      const dbUser = dbResult.rows[0];

      expect(dbUser).toBeDefined();
      expect(dbUser.username).toBe(testUsername);
      expect(dbUser.hashed_password).not.toBe(testPassword);
      expect(dbUser.hashed_password.startsWith('$argon2id$')).toBe(true);
    });

    it('2. Should reject login attempts with wrong password', async () => {
      const loginDto: LoginDto = {
        username: testUsername,
        password: 'WrongPassword123!',
      };

      await expect(
        authService.login(loginDto, {
          ip: '127.0.0.1',
          fingerprint: 'test-print',
          userAgent: 'test-agent',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('3. Should successfully log in, log audit, store session in Redis, and issue a Refresh Token', async () => {
      const loginDto: LoginDto = {
        username: testUsername,
        password: testPassword,
      };

      const result = await authService.login(loginDto, {
        ip: '127.0.0.1',
        fingerprint: 'test-print',
        userAgent: 'test-agent',
      });

      expect(result.refreshToken).toBeDefined();
      expect(typeof result.refreshToken).toBe('string');

      // Save for the next test
      savedRefreshToken = result.refreshToken;
    });

    it('4. Should issue a new Access Token when a valid Refresh Token is provided', async () => {
      const newAccessToken = await authService.refresh(savedRefreshToken);

      expect(newAccessToken).toBeDefined();
      expect(typeof newAccessToken).toBe('string');
      expect(newAccessToken.split('.')).toHaveLength(3);
    });

    it('5. Should successfully log out and revoke the Refresh Token in Redis', async () => {
      await authService.logout(savedRefreshToken);

      // Verify Redis no longer trusts this token
      await expect(authService.refresh(savedRefreshToken)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
