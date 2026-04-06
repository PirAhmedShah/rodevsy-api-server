import { PostgresErrorCode } from '@/infrastructure/db/db.enum';
import { DbService } from '@/infrastructure/db/db.service';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { User, UserLoginLog } from './user.entity';

export interface UserRow extends QueryResultRow {
  id: string;
  username: string;
  email: string;
  hashed_password: string;
  first_name: string;
  last_name: string;
  date_of_birth: Date;
}

@Injectable()
export class UserRepository {
  private readonly logger = new Logger(UserRepository.name);
  constructor(private readonly dbService: DbService) {
    this.logger.debug('Constructed.');
  }

  async save(user: User): Promise<Partial<UserRow>> {
    this.logger.debug('Creating User...');
    const sql = `
      INSERT INTO users (email, hashed_password, date_of_birth, username, first_name, last_name, gender)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `,
      values = [
        user.email,
        user.hashedPassword,
        user.dob,
        user.username,
        user.firstName,
        user.lastName,
        user.gender,
      ];

    try {
      const res = await this.dbService.query(sql, values);
      return res.rows[0];
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async logLogin(data: UserLoginLog): Promise<void> {
    const query = `
    INSERT INTO login_history (user_id, ip, fingerprint, success, used_2fa, user_agent, jti)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
    try {
      await this.dbService.query(query, [
        data.userId,
        data.ip,
        data.fingerprint,
        data.success,
        data.used2fa,
        data.userAgent,
        data.jti,
      ]);
    } catch (err) {
      this.logger.error('Failed to log login attempt', err);
    }
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const normalized = username.trim().toLowerCase(),
      sql = `SELECT * FROM users WHERE lower(username) = $1 LIMIT 1;`,
      res = await this.dbService.query<UserRow>(sql, [normalized]);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  private handleDatabaseError(error: unknown): never {
    // Type guard for Postgres errors (objects with a 'code' string)
    if (error instanceof Error && 'code' in error) {
      const pgError = error as { code: string; detail?: string };
      if (pgError.code === PostgresErrorCode.UniqueViolation) {
        throw new ConflictException('Username or email already exists');
      }
      if (pgError.code === PostgresErrorCode.InsufficientPrivilege) {
        throw new InternalServerErrorException(
          'Database security policy violation',
        );
      }
    }
    throw new InternalServerErrorException(
      'An unexpected database error occurred',
    );
  }
}
