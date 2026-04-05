import { Token } from './jwt.entity';
import { JwtAudience, JwtType } from './jwt.enum';

import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { SignJWT, importPKCS8, importSPKI, jwtVerify } from 'jose';
import type { JWTVerifyResult, KeyObject } from 'jose';
import {
  JWSSignatureVerificationFailed,
  JWTClaimValidationFailed,
  JWTExpired,
  JWTInvalid,
} from 'jose/errors';

@Injectable()
export class JwtService implements OnModuleInit {
  #privateKey!: KeyObject;
  #publicKey!: KeyObject;
  private issuer!: string;
  private audience!: JwtAudience;

  private readonly logger = new Logger(JwtService.name);
  private readonly alg = 'EdDSA';

  constructor(private readonly configService: ConfigService) {
    this.logger.debug('Constructed.');
  }

  async onModuleInit(): Promise<void> {
    this.issuer = this.configService.getOrThrow('JWT_ISSUER');
    this.audience = this.configService.getOrThrow<JwtAudience>('JWT_AUDIENCE');

    // 1. Load file paths from environment
    const privatePath =
        this.configService.getOrThrow<string>('JWT_PRIVATE_FILE'),
      publicPath = this.configService.getOrThrow<string>('JWT_PUBLIC_FILE'),
      // 2. Read file contents (Synchronous is fine in onModuleInit)
      privatePem = fs.readFileSync(privatePath, 'utf8'),
      publicPem = fs.readFileSync(publicPath, 'utf8');

    // 3. Import keys into JOSE internal format
    // This parses the PEM string into a usable key object
    this.#privateKey = await importPKCS8(privatePem, this.alg);
    this.#publicKey = await importSPKI(publicPem, this.alg);
    this.logger.debug('Initialized.');
  }

  // Inside JwtService
  async sign(token: Token): Promise<string> {
    this.logger.debug(`Signing ${token.type} token for sub: ${token.sub}`);

    return await new SignJWT({ type: token.type })
      .setProtectedHeader({ alg: this.alg, typ: 'JWT' })
      .setSubject(token.sub)
      .setAudience(token.aud)
      .setJti(token.jti)
      .setIssuedAt()
      .setExpirationTime(token.expiresAt)
      .setIssuer(this.configService.getOrThrow('JWT_ISSUER'))
      .sign(this.#privateKey);
  }

  async verify(token: string, type: JwtType): Promise<JWTVerifyResult> {
    this.logger.debug(`Verifying ${type} token...`);

    try {
      if (typeof token !== 'string') throw new Error('Token must be string!');
      const result = await jwtVerify(token, this.#publicKey, {
        algorithms: [this.alg],
        issuer: this.issuer,
        audience: this.audience,
        typ: 'JWT',
      });

      // Manually check for exp if not already validated by jose
      if (!result.payload.exp) {
        throw new JWTClaimValidationFailed(
          'Missing "exp" claim',
          result.payload,
          'exp',
          'check_presence',
        );
      }

      if (result.payload.type !== type) {
        this.logger.error('JWT verification failed');
        throw new ForbiddenException('Token used for wrong purpose');
      }

      return result;
    } catch (err: unknown) {
      // 1. Re-throw ForbiddenException directly
      this.logger.error('JWT verification failed');
      if (err instanceof ForbiddenException) {
        throw err;
      }

      // 2. Handle Expiration specifically
      if (err instanceof JWTExpired) {
        throw new UnauthorizedException('Token expired');
      }

      // 3. Group ALL jose errors under "Invalid token" to satisfy your test requirements
      // Safely check for fallback JOSE error codes without using 'any'
      const isJoseErrorCode =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof err.code === 'string' &&
        (err.code.startsWith('ERR_JWT_') || err.code.startsWith('ERR_JWS_'));

      const isJoseError =
        err instanceof JWTInvalid ||
        err instanceof JWSSignatureVerificationFailed ||
        err instanceof JWTClaimValidationFailed ||
        isJoseErrorCode;

      if (isJoseError) {
        throw new UnauthorizedException('Invalid token');
      }

      // 4. Final fallback
      throw new UnauthorizedException('Token verification failed');
    }
  }
}
