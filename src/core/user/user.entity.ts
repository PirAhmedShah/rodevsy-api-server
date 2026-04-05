import { SignupDto } from '@/features/auth/dtos';

type UserData = Omit<SignupDto, 'password'> & { hashedPassword: string };

export class User {
  constructor(
    public readonly email: string,
    public readonly username: string,
    public readonly hashedPassword: string,
    public readonly firstName: string,
    public readonly lastName: string,
    public readonly dob: Date,
    public readonly gender: string,
    public readonly type: string,
  ) {}

  static create(data: UserData): User {
    return new User(
      data.email.toLowerCase().trim(),
      data.username.toLowerCase().trim(),
      data.hashedPassword,
      data.firstName,
      data.lastName,
      data.dob,
      data.gender,
      data.type,
    );
  }
}

interface UserLoginLogData {
  userId: string;
  ip: string;
  fingerprint: string;
  success: boolean;
  userAgent: string;
  used2fa: boolean;
  jti: string | null;
}

export class UserLoginLog {
  constructor(
    public readonly userId: string,
    public readonly ip: string,
    public readonly fingerprint: string,
    public readonly success: boolean,
    public readonly userAgent: string,
    public readonly used2fa: boolean,
    public readonly jti: string | null,
  ) {}

  static create(data: UserLoginLogData): UserLoginLog {
    return new UserLoginLog(
      data.userId,
      data.ip,
      data.fingerprint,
      data.success,
      data.userAgent,
      data.used2fa,
      data.jti,
    );
  }
}
