import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from './signup.dto';
import { UserGender, UserType } from '@/core/user/user.enum';

describe('SignupDto', () => {
  it('should transform the dob string into a Date instance', async () => {
    const plainPayload = {
        email: 'valid.email@example.com',
        password: 'StrongPassword123!',
        dob: '2005-05-15',
        username: 'johndoe',
        firstName: 'John',
        lastName: 'Doe',
        type: UserType.CLIENT,
        gender: UserGender.MALE,
      },
      dtoInstance = plainToInstance(SignupDto, plainPayload);

    expect(dtoInstance.dob).toBeInstanceOf(Date);
    expect(dtoInstance.dob.toISOString()).toMatch(/^2005-05-15/);

    const errors = await validate(dtoInstance);
    expect(errors.length).toBe(0);
  });
});
