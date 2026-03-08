import { ILoginLog } from 'src/auth/auth.type';

export class LoginLog {
  constructor(
    public readonly userId: string,
    public readonly ip: string,
    public readonly fingerprint: string,
    public readonly success: boolean,
    public readonly userAgent: string,
    public readonly used2fa: boolean,
    public readonly jti: string | null,
  ) {}

  static create(data: ILoginLog): LoginLog {
    return new LoginLog(
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
