import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from 'jose';
import type { JWTVerifyResult, KeyObject } from 'jose';
import { JwtAudience, JwtType } from './jwt.type';
import { Token } from 'src/entities/token.entity';
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

  async onModuleInit() {
    this.issuer = this.configService.getOrThrow('JWT_ISSUER');
    this.audience = this.configService.getOrThrow<JwtAudience>('JWT_AUDIENCE');

    // 1. Load file paths from environment
    const privatePath =
      this.configService.getOrThrow<string>('JWT_PRIVATE_FILE');
    const publicPath = this.configService.getOrThrow<string>('JWT_PUBLIC_FILE');

    // 2. Read file contents (Synchronous is fine in onModuleInit)
    const privatePem = fs.readFileSync(privatePath, 'utf8');
    const publicPem = fs.readFileSync(publicPath, 'utf8');

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
      const result = await jwtVerify(token, this.#publicKey, {
        algorithms: [this.alg],
        issuer: this.issuer,
        audience: this.audience,
        typ: 'JWT',
      });

      // BUSINESS RULE – not crypto
      if (result.payload.type !== type) {
        this.logger.warn('Token purpose mismatch', {
          expected: type,
          got: result.payload.type,
          sub: result.payload.sub,
        });

        throw new ForbiddenException('Token used for wrong purpose');
      }

      return result;
    } catch (err: unknown) {
      if (err instanceof JWTExpired) {
        throw new UnauthorizedException('Token expired');
      }

      if (
        err instanceof JWTInvalid ||
        err instanceof JWSSignatureVerificationFailed ||
        err instanceof JWTClaimValidationFailed
      ) {
        throw new UnauthorizedException('Invalid token');
      }

      if (err instanceof ForbiddenException) {
        throw err;
      }

      const message = err instanceof Error ? err.message : 'unknown error';

      this.logger.error('JWT verification failed', message);

      throw new UnauthorizedException('Token verification failed');
    }
  }
}
