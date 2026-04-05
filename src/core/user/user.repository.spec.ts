import { Test, TestingModule } from '@nestjs/testing';
import { UserRepository } from './user.repository';
import { DbService } from '@/infrastructure/db/db.service';
import { PostgresErrorCode } from '@/infrastructure/db/db.enum';
import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { User, UserLoginLog } from './user.entity';
import { SilentLogger } from '@/common/utils';
import { UserGender, UserType } from './user.enum';

describe('UserRepository', () => {
  let dbService: DbService, repository: UserRepository;

  const mockDbService = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        { provide: DbService, useValue: mockDbService },
      ],
    })
      .setLogger(SilentLogger)
      .compile();

    repository = module.get<UserRepository>(UserRepository);
    dbService = module.get<DbService>(DbService);
    jest.clearAllMocks();
  });

  describe('save()', () => {
    const mockUser = new User(
      'test@example.com',
      'testuser',
      'hashed_pass',
      'First',
      'Last',
      new Date(),
      'male',
      'Developer',
    );

    it('should insert a user and return the new ID', async () => {
      mockDbService.query.mockResolvedValue({ rows: [{ id: 'uuid-123' }] });

      const result = await repository.save(mockUser);

      expect(result).toEqual({ id: 'uuid-123' });
      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.any(Array),
      );
    });

    it('should throw ConflictException on unique constraint violation', async () => {
      const dbError = new Error('Unique violation');
      (dbError as any).code = PostgresErrorCode.UniqueViolation;
      mockDbService.query.mockRejectedValue(dbError);

      await expect(repository.save(mockUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findByUsername()', () => {
    it('should return a user row if found', async () => {
      const mockRow = { id: '1', username: 'testuser', email: 'test@test.com' };
      mockDbService.query.mockResolvedValue({ rows: [mockRow] });

      const result = await repository.findByUsername('TESTUSER '); // Testing normalization

      expect(result).toEqual(mockRow);
      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE lower(username) = $1'),
        ['testuser'],
      );
    });

    it('should return null if no user is found', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });
      const result = await repository.findByUsername('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('logLogin()', () => {
    it('should call query with correct login log data', async () => {
      const log = new UserLoginLog(
        'u1',
        '127.0.0.1',
        'fp',
        true,
        'ua',
        false,
        'jti',
      );
      mockDbService.query.mockResolvedValue({ rows: [] });

      await repository.logLogin(log);

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO login_history'),
        ['u1', '127.0.0.1', 'fp', true, false, 'ua', 'jti'],
      );
    });

    it('should swallow errors and not throw when query fails', async () => {
      const log = new UserLoginLog(
        'u2',
        '10.0.0.1',
        'fp2',
        false,
        'ua2',
        false,
        null,
      );
      mockDbService.query.mockRejectedValue(new Error('DB connection lost'));

      await expect(repository.logLogin(log)).resolves.toBeUndefined();
    });
  });

  describe('handleDatabaseError() - via save()', () => {
    const mockUser: User = User.create({
      username: 'test',
      hashedPassword: 'test',
      dob: new Date(),
      gender: UserGender.FEMALE,
      type: UserType.CLIENT,
      email: 'test@mail.net',
      firstName: 'test',
      lastName: 'test',
    });

    it('should throw InternalServerErrorException on InsufficientPrivilege', async () => {
      const dbError = new Error('Permission denied');
      (dbError as any).code = PostgresErrorCode.InsufficientPrivilege;
      mockDbService.query.mockRejectedValue(dbError);

      await expect(repository.save(mockUser)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException on generic unknown DB error', async () => {
      mockDbService.query.mockRejectedValue(new Error('Unknown error'));

      await expect(repository.save(mockUser)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException for a non-Error thrown value', async () => {
      mockDbService.query.mockRejectedValue('string error');

      await expect(repository.save(mockUser)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
