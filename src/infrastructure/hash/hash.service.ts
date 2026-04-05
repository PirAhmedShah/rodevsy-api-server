import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class HashService {
  private readonly logger = new Logger(HashService.name);
  constructor() {
    this.logger.debug('Constructed.');
  }

  async hash(password: string): Promise<string> {
    this.logger.debug('Hashing...');
    try {
      return await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 32768,
        timeCost: 3,
        parallelism: 1,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to hash password: ${errorMessage}`);
      throw new InternalServerErrorException('Error securing credentials');
    } finally {
      this.logger.debug('End.');
    }
  }
  async verify(hash: string, password: string): Promise<boolean> {
    this.logger.debug('Verifying...');
    try {
      return await argon2.verify(hash, password);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Password verification error: ${errorMessage}`);
      return false;
    } finally {
      this.logger.debug('End.');
    }
  }
}
