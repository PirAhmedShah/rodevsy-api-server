// src/auth/domain/user.entity.ts
import { SignupDto } from 'src/auth/dto';

export class User {
  // We use readonly to ensure the state remains immutable once created
  constructor(
    public readonly email: string,
    public readonly username: string,
    public readonly hashedPassword: string,
    public readonly firstName: string,
    public readonly lastName: string,
    public readonly dob: Date,
    public readonly gender: string,
    public readonly type: string,
  ) {}

  static create(data: SignupDto & { hashedPassword: string }): User {
    return new User(
      data.email.toLowerCase().trim(),
      data.username,
      data.hashedPassword,
      data.firstName,
      data.lastName,
      data.dob,
      data.gender,
      data.type,
    );
  }
}
