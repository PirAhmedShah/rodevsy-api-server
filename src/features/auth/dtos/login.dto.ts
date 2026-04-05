import {
  IsAlphanumeric,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  Length,
} from 'class-validator';

export class LoginDto {
  // --- Username ---
  @IsNotEmpty({ message: 'Username is required.' })
  @IsString({ message: 'Username must be a text value.' })
  @IsAlphanumeric('en-US', {
    message: 'Username can only contain letters and numbers.',
  })
  @Length(4, 30, { message: 'Username must be between 4 and 30 characters.' })
  username!: string;

  @IsNotEmpty({ message: 'Password is required.' })
  @IsString({ message: 'Password must be a text value.' })
  @Length(8, 64, { message: 'Password must be between 8 and 64 characters.' })
  @IsStrongPassword(
    {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message: 'Invalid password format. Please check your credentials.',
    },
  )
  password!: string;
}
