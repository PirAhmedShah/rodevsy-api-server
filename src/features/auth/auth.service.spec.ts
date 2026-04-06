import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRepository } from '@/core/user/user.repository';
import { UserCacheRepository } from '@/core/user/user.cache.repository';
import { HashService } from '@/infrastructure/hash/hash.service';
import { JwtService } from '@/infrastructure/jwt/jwt.service';
import { JwtAudience, JwtType } from '@/infrastructure/jwt/jwt.enum';
import { User, UserLoginLog } from '@/core/user/user.entity';
import {
  AccessToken,
  RefreshToken,
  Token,
} from '@/infrastructure/jwt/jwt.entity';
import { UserGender, UserType } from '@/core/user/user.enum';
import { SilentLogger } from '@/common/utils';

// --- Mocks ---

const mockUserRepository = {
    save: jest.fn(),
    findByUsername: jest.fn(),
    logLogin: jest.fn().mockResolvedValue(undefined),
  },
  mockHashService = {
    hash: jest.fn(),
    verify: jest.fn(),
  },
  mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  },
  mockUserCacheRepository = {
    storeRefreshToken: jest.fn(),
    isTokenStored: jest.fn(),
    revokeRefreshToken: jest.fn(),
  };

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: HashService, useValue: mockHashService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: UserCacheRepository, useValue: mockUserCacheRepository },
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    authService = module.get<AuthService>(AuthService);

    // Clear all mock implementations and histories before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  describe('signup', () => {
    it('should successfully hash password, save, and return a new user', async () => {
      const signupDto = {
          email: 'test@example.com',
          password: 'Password123!',
          dob: new Date('2000-01-01'),
          username: 'testuser',
          firstName: 'Test',
          lastName: 'User',
          type: UserType.CLIENT, // Assuming STANDARD exists in your enum
          gender: UserGender.MALE, // Assuming MALE exists in your enum
        },
        hashedPassword = 'hashed_password_123';
      mockHashService.hash.mockResolvedValue(hashedPassword);

      const mockSavedUser = { id: 'uuid-123', ...signupDto, hashedPassword };
      mockUserRepository.save.mockResolvedValue(mockSavedUser);

      // Spy on User.create if it's a static method
      const userCreateSpy = jest
          .spyOn(User, 'create')
          .mockReturnValue(mockSavedUser),
        result = await authService.signup(signupDto);
      const { password, ...restDto } = signupDto;
      expect(mockHashService.hash).toHaveBeenCalledWith(password);
      expect(userCreateSpy).toHaveBeenCalledWith({
        ...restDto,
        hashedPassword,
      });
      expect(mockUserRepository.save).toHaveBeenCalledWith(mockSavedUser);
      expect(result).toEqual(mockSavedUser);

      userCreateSpy.mockRestore();
    });
  });

  describe('login', () => {
    const loginDto = { username: 'testuser', password: 'Password123!' },
      metadata = {
        ip: '127.0.0.1',
        fingerprint: 'print123',
        userAgent: 'Jest',
      },
      mockUser = {
        id: 'uuid-123',
        username: 'testuser',
        hashed_password: 'hashed_password_123',
      };

    it('should throw UnauthorizedException if user is not found', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(null);

      await expect(authService.login(loginDto, metadata)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUserRepository.findByUsername).toHaveBeenCalledWith(
        loginDto.username,
      );
      expect(mockHashService.verify).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);
      mockHashService.verify.mockResolvedValue(false);

      await expect(authService.login(loginDto, metadata)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockHashService.verify).toHaveBeenCalledWith(
        mockUser.hashed_password,
        loginDto.password,
      );
    });

    it('should log audit asynchronously and return a signed refresh token on success', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);
      mockHashService.verify.mockResolvedValue(true);
      mockUserRepository.logLogin.mockResolvedValue(undefined);

      const mockSignedToken = 'signed.jwt.token';
      mockJwtService.sign.mockResolvedValue(mockSignedToken);

      const logCreateSpy = jest
          .spyOn(UserLoginLog, 'create')
          .mockReturnValue({} as UserLoginLog),
        refreshCreateSpy = jest.spyOn(RefreshToken, 'create').mockReturnValue({
          jti: 'jti-123',
          sub: mockUser.id,
        } as RefreshToken),
        result = await authService.login(loginDto, metadata);

      expect(mockHashService.verify).toHaveBeenCalled();
      expect(logCreateSpy).toHaveBeenCalledWith({
        ...metadata,
        userId: mockUser.id,
        success: true,
        jti: null,
        used2fa: false,
      });
      expect(mockUserRepository.logLogin).toHaveBeenCalled(); // Audit log
      expect(mockUserCacheRepository.storeRefreshToken).toHaveBeenCalled();
      expect(mockJwtService.sign).toHaveBeenCalled();
      expect(result).toEqual({ refreshToken: mockSignedToken });

      logCreateSpy.mockRestore();
      refreshCreateSpy.mockRestore();
    });

    it('should not block login if audit log throws an error', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);
      mockHashService.verify.mockResolvedValue(true);

      // Simulate db failure on logging
      mockUserRepository.logLogin.mockRejectedValue(new Error('DB Error'));
      mockJwtService.sign.mockResolvedValue('signed.jwt.token');

      // The login should still succeed and return the token
      const result = await authService.login(loginDto, metadata);
      expect(result).toHaveProperty('refreshToken', 'signed.jwt.token');
    });
  });

  describe('refresh', () => {
    const refreshTokenStr = 'valid.refresh.token';

    it('should throw UnauthorizedException if token string is missing', async () => {
      await expect(authService.refresh(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ForbiddenException if token is not whitelisted', async () => {
      const payload: Token = {
        sub: 'user-123',
        jti: 'jti-123',
        expiresAt: 0,
        type: JwtType.REFRESH,
        aud: JwtAudience.TEST,
      };
      mockJwtService.verify.mockResolvedValue({ payload });

      const refreshFromPayloadSpy = jest
        .spyOn(RefreshToken, 'fromPayload')
        .mockReturnValue(payload);
      mockUserCacheRepository.isTokenStored.mockResolvedValue(false);

      await expect(authService.refresh(refreshTokenStr)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockJwtService.verify).toHaveBeenCalledWith(
        refreshTokenStr,
        JwtType.REFRESH,
      );
      expect(mockUserCacheRepository.isTokenStored).toHaveBeenCalledWith(
        payload,
      );

      refreshFromPayloadSpy.mockRestore();
    });

    it('should return a new signed access token if refresh token is valid and whitelisted', async () => {
      const payload: Token = {
        sub: 'user-123',
        jti: 'jti-123',
        expiresAt: 0,
        type: JwtType.REFRESH,
        aud: JwtAudience.TEST,
      };
      mockJwtService.verify.mockResolvedValue({ payload });

      const mockNewAccessToken = {
        sub: 'user-123',
        jti: 'new-jti-456',
        expiresAt: 0,
        type: JwtType.ACCESS,
        aud: JwtAudience.TEST,
      };
      const refreshFromPayloadSpy = jest
        .spyOn(RefreshToken, 'fromPayload')
        .mockReturnValue(payload);
      const accessCreateSpy = jest
        .spyOn(AccessToken, 'create')
        .mockReturnValue(mockNewAccessToken);

      mockUserCacheRepository.isTokenStored.mockResolvedValue(true);
      mockJwtService.sign.mockResolvedValue('new.access.token');

      const result = await authService.refresh(refreshTokenStr);

      expect(mockUserCacheRepository.isTokenStored).toHaveBeenCalledWith(
        payload,
      );
      expect(accessCreateSpy).toHaveBeenCalledWith(
        payload.sub,
        expect.any(String),
      );
      expect(mockJwtService.sign).toHaveBeenCalledWith(mockNewAccessToken);
      expect(result).toBe('new.access.token');

      refreshFromPayloadSpy.mockRestore();
      accessCreateSpy.mockRestore();
    });

    it('should throw if jwtService.verify throws (e.g., token expired)', async () => {
      mockJwtService.verify.mockRejectedValue(new Error('jwt expired'));

      await expect(authService.refresh(refreshTokenStr)).rejects.toThrow(
        'jwt expired',
      );
    });
  });

  describe('logout', () => {
    it('should return immediately if no refresh token is provided', async () => {
      await authService.logout(undefined);
      expect(mockJwtService.verify).not.toHaveBeenCalled();
      expect(mockUserCacheRepository.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it('should verify and revoke the refresh token if provided', async () => {
      const refreshTokenStr = 'valid.refresh.token';
      const payload: Token = {
        sub: 'user-123',
        jti: 'jti-123',
        expiresAt: 0,
        type: JwtType.REFRESH,
        aud: JwtAudience.TEST,
      };
      mockJwtService.verify.mockResolvedValue({ payload });
      const refreshFromPayloadSpy = jest
        .spyOn(RefreshToken, 'fromPayload')
        .mockReturnValue(payload);
      mockUserCacheRepository.revokeRefreshToken.mockResolvedValue(undefined);

      await authService.logout(refreshTokenStr);

      expect(mockJwtService.verify).toHaveBeenCalledWith(
        refreshTokenStr,
        JwtType.REFRESH,
      );
      expect(mockUserCacheRepository.revokeRefreshToken).toHaveBeenCalledWith(
        payload,
      );

      refreshFromPayloadSpy.mockRestore();
    });

    it('should catch and ignore errors if token verification fails', async () => {
      const refreshTokenStr = 'invalid.refresh.token';
      mockJwtService.verify.mockRejectedValue(new Error('jwt malformed'));

      // Should not throw an exception out of the method
      await expect(authService.logout(refreshTokenStr)).resolves.not.toThrow();
      expect(mockUserCacheRepository.revokeRefreshToken).not.toHaveBeenCalled();
    });
  });
});
