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

  /**
   * The function uses the argon2 library to securely hash a password with specific parameters.
   * @param {string} password - The `hash` function you provided is using the Argon2 password hashing
   * algorithm to securely hash a given password. The parameters used in the Argon2 hashing function
   * are as follows:
   * @returns The `hash` function is returning a hashed version of the provided `password` using the
   * Argon2 hashing algorithm with specific parameters such as `memoryCost`, `timeCost`, and
   * `parallelism`.
   */
  async hash(password: string): Promise<string> {
    this.logger.debug('Hashing...');
    try {
      return await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 32768,
        timeCost: 3,
        parallelism: 1,
      });
    } catch (error) {
      this.logger.error(`Failed to hash password: ${error}`);
      throw new InternalServerErrorException('Error securing credentials');
    } finally {
      this.logger.debug('End.');
    }
  }

  /**
   * The function uses the argon2 library to verify a password against a given hash string.
   * @param {string} hash - The `hash` parameter is a string that represents the hashed version of a
   * password. It is using a cryptographic hashing algorithm - Argon2, which is
   * a secure and recommended choice for password hashing.
   * @param {string} password - The `password` parameter is a string that represents the user's input
   * password that needs to be verified against the hashed password stored in the database.
   * @returns The `verify` function is returning a Promise that resolves to a boolean value. If the
   * password matches the hash, it will return `true`, indicating a successful verification. If there
   * is an error during the verification process, it will log the error and return `false`.
   */
  async verify(hash: string, password: string): Promise<boolean> {
    this.logger.debug('Verifying...');
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      this.logger.error(`Password verification error: ${error}`);
      return false;
    } finally {
      this.logger.debug('End.');
    }
  }
}
