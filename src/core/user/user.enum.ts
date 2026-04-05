export const UserType = {
  DEVELOPER: 'Developer',
  CLIENT: 'Client',
} as const;

export type UserType = (typeof UserType)[keyof typeof UserType];

export const UserGender = {
  MALE: 'male',
  FEMALE: 'female',
  OTHERS: 'others',
} as const;

export type UserGender = (typeof UserGender)[keyof typeof UserGender];
