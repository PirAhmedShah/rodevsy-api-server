import { User, UserLoginLog } from './user.entity';
import { UserGender, UserType } from './user.enum';

describe('User', () => {
  describe('create()', () => {
    it('should normalise email to lowercase and trimmed', () => {
      const user = User.create({
        email: '  Test@Example.COM  ',
        username: 'testuser',
        hashedPassword: 'hashed',
        firstName: 'First',
        lastName: 'Last',
        dob: new Date('1990-01-01'),
        gender: 'male',
        type: 'Developer',
      });

      expect(user.email).toBe('test@example.com');
    });

    it('should pass all other fields through unchanged', () => {
      const dob = new Date('1995-06-15'),
        user = User.create({
          email: 'a@b.com',
          username: 'myuser',
          hashedPassword: 'hashed_pass',
          firstName: 'Jane',
          lastName: 'Doe',
          dob,
          gender: UserGender.MALE,
          type: UserType.CLIENT,
        });

      expect(user.username).toBe('myuser');
      expect(user.hashedPassword).toBe('hashed_pass');
      expect(user.firstName).toBe('Jane');
      expect(user.lastName).toBe('Doe');
      expect(user.dob).toBe(dob);
      expect(user.gender).toBe(UserGender.MALE);
      expect(user.type).toBe(UserType.CLIENT);
    });

    it('should return a User instance', () => {
      const user = User.create({
        email: 'x@y.com',
        username: 'u',
        hashedPassword: 'h',
        firstName: 'F',
        lastName: 'L',
        dob: new Date(),
        gender: UserGender.FEMALE,
        type: UserType.DEVELOPER,
      });

      expect(user).toBeInstanceOf(User);
    });
  });
});

describe('UserLoginLog', () => {
  describe('create()', () => {
    it('should map all fields from the data object', () => {
      const data = {
          userId: 'u-1',
          ip: '192.168.1.1',
          fingerprint: 'fp-abc',
          success: true,
          userAgent: 'Mozilla/5.0',
          used2fa: false,
          jti: 'jti-xyz',
        },
        log = UserLoginLog.create(data);

      expect(log).toBeInstanceOf(UserLoginLog);
      expect(log.userId).toBe(data.userId);
      expect(log.ip).toBe(data.ip);
      expect(log.fingerprint).toBe(data.fingerprint);
      expect(log.success).toBe(data.success);
      expect(log.userAgent).toBe(data.userAgent);
      expect(log.used2fa).toBe(data.used2fa);
      expect(log.jti).toBe(data.jti);
    });

    it('should support null jti', () => {
      const log = UserLoginLog.create({
        userId: 'u-2',
        ip: '10.0.0.1',
        fingerprint: 'fp-null',
        success: false,
        userAgent: 'curl/7.0',
        used2fa: false,
        jti: null,
      });

      expect(log.jti).toBeNull();
    });
  });
});
