import {
  IsAlpha,
  IsAlphanumeric,
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  Length,
  MaxDate,
  MaxLength,
  MinDate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { getDateInPastByYears } from '@/common/utils';
import { UserGender, UserType } from '@/core/user/user.enum';

export class SignupDto {
  @IsNotEmpty({ message: 'Email address is required.' })
  @IsString({ message: 'Email must be a text value.' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @Length(5, 100, { message: 'Email must be between 5 and 100 characters.' })
  email!: string;

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
      message:
        'Password must contain at least 8 characters, 1 uppercase letter, 1 number, and 1 symbol.',
    },
  )
  password!: string;

  // --- Date of Birth ---
  @IsNotEmpty({ message: 'Date of birth is required.' })
  @Type(() => Date)
  @IsDate({ message: 'Please provide a valid date.' })
  @MaxDate(getDateInPastByYears(13), {
    message: 'You must be at least 13 years old to sign up.',
  })
  @MinDate(getDateInPastByYears(100), {
    message: 'Please enter a valid date of birth.',
  })
  dob!: Date;

  // --- Username ---
  @IsNotEmpty({ message: 'Username is required.' })
  @IsString({ message: 'Username must be a text value.' })
  @IsAlphanumeric('en-US', {
    message: 'Username can only contain letters and numbers (no spaces).',
  })
  @Length(4, 30, { message: 'Username must be between 4 and 30 characters.' })
  username!: string;

  // --- First Name ---
  @IsNotEmpty({ message: 'First name is required.' })
  @IsString({ message: 'First name must be a text value.' })
  @IsAlpha('en-US', { message: 'First name can only contain letters.' })
  @Length(2, 32, { message: 'First name must be between 2 and 32 characters.' })
  firstName!: string;

  // --- Last Name ---
  @IsNotEmpty({ message: 'Last name is required.' })
  @IsString({ message: 'Last name must be a text value.' })
  @IsAlpha('en-US', { message: 'Last name can only contain letters.' })
  @Length(2, 32, { message: 'Last name must be between 2 and 32 characters.' })
  lastName!: string;

  // --- User Type ---
  @IsNotEmpty({ message: 'Account type is required.' })
  @MaxLength(50, { message: 'Account type is too long.' })
  @IsEnum(UserType, { message: 'Please select a valid account type.' })
  type!: UserType;

  // --- User Gender ---
  @IsNotEmpty({ message: 'Gender is required.' })
  @MaxLength(10, { message: 'Gender is too long.' })
  @IsEnum(UserGender, { message: 'Please select a valid gender.' })
  gender!: UserGender;
}
