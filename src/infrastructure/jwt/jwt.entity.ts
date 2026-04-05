import { JWTPayload } from 'jose';
import { JwtAudience, JwtType } from './jwt.enum';

export abstract class Token {
  static readonly TOKEN_TYPE: JwtType;
  constructor(
    public readonly sub: string,
    public readonly jti: string,
    public readonly type: JwtType,
    public readonly aud: JwtAudience,
    public readonly expiresAt: number,
  ) {}
  static fromPayload<T extends Token>(
    this: (new (
      sub: string,
      jti: string,
      type: JwtType,
      aud: JwtAudience,
      expiresAt: number,
    ) => T) & { TOKEN_TYPE: JwtType },
    payload: JWTPayload,
  ): T {
    const { sub, jti, exp, aud, type } = payload;

    if (
      typeof sub !== 'string' ||
      typeof jti !== 'string' ||
      typeof exp !== 'number'
    )
      throw new Error('Incomplete or invalid JWT payload claims');

    if (type !== this.TOKEN_TYPE)
      throw new Error(
        `Type mismatch: Expected ${this.TOKEN_TYPE} but got ${String(type)}`,
      );

    if (aud !== JwtAudience.API)
      throw new Error(`Invalid audience: ${String(aud)}`);

    return new this(sub, jti, type as JwtType, aud as JwtAudience, exp);
  }
}

export class AccessToken extends Token {
  static readonly TOKEN_TYPE: JwtType = JwtType.ACCESS;
  static readonly LIFETIME = 15 * 60;

  static create(userId: string, jti: string): AccessToken {
    const expiry = Math.floor(Date.now() / 1000) + AccessToken.LIFETIME;
    return new AccessToken(
      userId,
      jti,
      JwtType.ACCESS,
      JwtAudience.API,
      expiry,
    );
  }
}

export class RefreshToken extends Token {
  static readonly TOKEN_TYPE: JwtType = JwtType.REFRESH;
  static readonly LIFETIME = 7 * 24 * 60 * 60;

  static create(userId: string, jti: string): RefreshToken {
    const expiry = Math.floor(Date.now() / 1000) + RefreshToken.LIFETIME;
    return new RefreshToken(
      userId,
      jti,
      JwtType.REFRESH,
      JwtAudience.API,
      expiry,
    );
  }
}
