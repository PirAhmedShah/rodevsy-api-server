import { UserGender, UserType } from './user.enum';

export interface UserData {
  username: string;
  hashedPassword: string;
  firstName: string;
  lastName: string;
  email: string;
  dob: Date;
  gender: UserGender;
  type: UserType;
}
