import { AccessToken, RefreshToken } from './jwt.entity';
import { JwtAudience, JwtType } from './jwt.enum';

// ===========================================================================
// AccessToken entity unit tests
// ===========================================================================

describe('AccessToken', () => {
  it('should have TOKEN_TYPE equal to JwtType.ACCESS', () => {
    expect(AccessToken.TOKEN_TYPE).toBe(JwtType.ACCESS);
  });

  it('should set a LIFETIME of 15 minutes (900 seconds)', () => {
    expect(AccessToken.LIFETIME).toBe(900);
  });

  it('create() should return an AccessToken with correct sub and jti', () => {
    const token = AccessToken.create('user-a', 'jti-a');
    expect(token.sub).toBe('user-a');
    expect(token.jti).toBe('jti-a');
  });

  it('create() should set type to JwtType.ACCESS', () => {
    const token = AccessToken.create('user-b', 'jti-b');
    expect(token.type).toBe(JwtType.ACCESS);
  });

  it('create() should set aud to JwtAudience.API', () => {
    const token = AccessToken.create('user-c', 'jti-c');
    expect(token.aud).toBe(JwtAudience.API);
  });

  it('create() should set expiresAt ~15 minutes from now', () => {
    const before = Math.floor(Date.now() / 1000),
      token = AccessToken.create('user-d', 'jti-d'),
      after = Math.floor(Date.now() / 1000);

    expect(token.expiresAt).toBeGreaterThanOrEqual(
      before + AccessToken.LIFETIME,
    );
    expect(token.expiresAt).toBeLessThanOrEqual(after + AccessToken.LIFETIME);
  });

  it('fromPayload() should reconstruct an AccessToken from a valid payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 900,
      payload = {
        sub: 'user-fp',
        jti: 'jti-fp',
        exp,
        aud: JwtAudience.API,
        type: JwtType.ACCESS,
      },
      token = AccessToken.fromPayload(payload);
    expect(token).toBeInstanceOf(AccessToken);
    expect(token.sub).toBe('user-fp');
  });

  it('fromPayload() should throw on type mismatch', () => {
    const payload = {
      sub: 'user-tm',
      jti: 'jti-tm',
      exp: Math.floor(Date.now() / 1000) + 900,
      aud: JwtAudience.API,
      type: JwtType.REFRESH, // Wrong type
    };
    expect(() => AccessToken.fromPayload(payload)).toThrow(/Type mismatch/);
  });

  it('fromPayload() should throw on invalid audience', () => {
    const payload = {
      sub: 'user-aud',
      jti: 'jti-aud',
      exp: Math.floor(Date.now() / 1000) + 900,
      aud: 'WRONG',
      type: JwtType.ACCESS,
    };
    expect(() => AccessToken.fromPayload(payload)).toThrow(/Invalid audience/);
  });

  it('fromPayload() should throw when sub is missing', () => {
    const payload = {
      jti: 'jti-nosub',
      exp: Math.floor(Date.now() / 1000) + 900,
      aud: JwtAudience.API,
      type: JwtType.ACCESS,
    };
    expect(() => AccessToken.fromPayload(payload)).toThrow(
      /Incomplete or invalid JWT payload claims/,
    );
  });

  it('fromPayload() should throw when jti is missing', () => {
    const payload = {
      sub: 'user-nojti',
      exp: Math.floor(Date.now() / 1000) + 900,
      aud: JwtAudience.API,
      type: JwtType.ACCESS,
    };
    expect(() => AccessToken.fromPayload(payload)).toThrow(
      /Incomplete or invalid JWT payload claims/,
    );
  });

  it('fromPayload() should throw when exp is missing', () => {
    const payload = {
      sub: 'user-noexp',
      jti: 'jti-noexp',
      aud: JwtAudience.API,
      type: JwtType.ACCESS,
    };
    expect(() => AccessToken.fromPayload(payload)).toThrow(
      /Incomplete or invalid JWT payload claims/,
    );
  });
});

// ===========================================================================
// RefreshToken entity unit tests
// ===========================================================================

describe('RefreshToken', () => {
  it('should have TOKEN_TYPE equal to JwtType.REFRESH', () => {
    expect(RefreshToken.TOKEN_TYPE).toBe(JwtType.REFRESH);
  });

  it('should set a LIFETIME of 7 days (604800 seconds)', () => {
    expect(RefreshToken.LIFETIME).toBe(7 * 24 * 60 * 60);
  });

  it('create() should return a RefreshToken with correct sub and jti', () => {
    const token = RefreshToken.create('user-r', 'jti-r');
    expect(token.sub).toBe('user-r');
    expect(token.jti).toBe('jti-r');
  });

  it('create() should set type to JwtType.REFRESH', () => {
    const token = RefreshToken.create('user-r2', 'jti-r2');
    expect(token.type).toBe(JwtType.REFRESH);
  });

  it('create() should set aud to JwtAudience.API', () => {
    const token = RefreshToken.create('user-r3', 'jti-r3');
    expect(token.aud).toBe(JwtAudience.API);
  });

  it('create() should set expiresAt ~7 days from now', () => {
    const before = Math.floor(Date.now() / 1000),
      token = RefreshToken.create('user-r4', 'jti-r4'),
      after = Math.floor(Date.now() / 1000);

    expect(token.expiresAt).toBeGreaterThanOrEqual(
      before + RefreshToken.LIFETIME,
    );
    expect(token.expiresAt).toBeLessThanOrEqual(after + RefreshToken.LIFETIME);
  });

  it('fromPayload() should reconstruct a RefreshToken from a valid payload', () => {
    const exp = Math.floor(Date.now() / 1000) + RefreshToken.LIFETIME,
      payload = {
        sub: 'user-rfp',
        jti: 'jti-rfp',
        exp,
        aud: JwtAudience.API,
        type: JwtType.REFRESH,
      },
      token = RefreshToken.fromPayload(payload);
    expect(token).toBeInstanceOf(RefreshToken);
  });

  it('fromPayload() should throw on type mismatch (ACCESS used for REFRESH)', () => {
    const payload = {
      sub: 'user-rtm',
      jti: 'jti-rtm',
      exp: Math.floor(Date.now() / 1000) + 900,
      aud: JwtAudience.API,
      type: JwtType.ACCESS,
    };
    expect(() => RefreshToken.fromPayload(payload)).toThrow(/Type mismatch/);
  });
});
