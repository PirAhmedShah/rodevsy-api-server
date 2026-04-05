import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from '@/infrastructure/jwt/jwt.entity';
import { LoginDto, SignupDto } from './dtos';
import { Response } from 'express';
import { SilentLogger } from '@/common/utils';

// 1. Create a properly typed Mock
const mockAuthService = {
  signup: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
};

describe('AuthController', () => {
  let authController: AuthController;
  const originalEnv = process.env.NODE_ENV;

  // 2. Helper to create a typed Mock Response
  const createMockResponse = () =>
    ({
      cookie: jest.fn().mockReturnThis(),
    }) as unknown as Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .setLogger(SilentLogger)
      .compile();

    authController = module.get<AuthController>(AuthController);

    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('signup', () => {
    it('should call authService.signup and return the result', async () => {
      const signupDto: SignupDto = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'Password123!',
        firstName: 'Test',
        lastName: 'User',
        dob: new Date(),
        gender: 'male',
        type: 'Client',
      };
      const expectedResult = { id: 'user-123', username: 'testuser' };

      mockAuthService.signup.mockResolvedValue(expectedResult);

      const result = await authController.signup(signupDto);

      expect(mockAuthService.signup).toHaveBeenCalledWith(signupDto);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = { username: 'testuser', password: 'password' };
    const ip = '127.0.0.1';
    let mockRes: Response;

    beforeEach(() => {
      mockRes = createMockResponse();
      // Use Object.defineProperty only if necessary, or just rely on the entity
      Object.defineProperty(RefreshToken, 'LIFETIME', {
        value: 3600,
        configurable: true,
      });
    });

    it('should set secure cookie in production', async () => {
      process.env.NODE_ENV = 'production';
      const fingerprint = 'my-fingerprint';
      const refreshTokenStr = 'valid.refresh.token';
      const userAgent = 'Mozilla/5.0';

      mockAuthService.login.mockResolvedValue({
        refreshToken: refreshTokenStr,
      });

      await authController.login(loginDto, ip, fingerprint, userAgent, mockRes);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockRes.cookie).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refreshToken',
        refreshTokenStr,
        expect.objectContaining({ secure: true }),
      );
    });

    it('should use "unknown" fallbacks for missing headers', async () => {
      process.env.NODE_ENV = 'development';
      mockAuthService.login.mockResolvedValue({ refreshToken: 'token' });

      // Cast to string to satisfy type requirements instead of 'any'
      await authController.login(
        loginDto,
        ip,
        undefined as unknown as string,
        undefined as unknown as string,
        mockRes,
      );

      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto, {
        ip,
        fingerprint: 'unknown',
        userAgent: 'unknown',
      });
    });
  });

  describe('refresh', () => {
    it('should return a new access token', async () => {
      const mockRes = createMockResponse();
      const newAccessToken = 'new.access.token';
      mockAuthService.refresh.mockResolvedValue(newAccessToken);

      const result = await authController.refresh('valid.token', mockRes);

      expect(result).toEqual(newAccessToken);
    });
  });
});
