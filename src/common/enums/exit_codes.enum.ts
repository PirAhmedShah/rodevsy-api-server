export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,

  //Starting from 20 to avoid collision with system/node reserved codes
  DB_CONNECTION_ERROR: 20,
  CONFIG_MISSING: 21,
  INVALID_USER_INPUT: 22,
  THIRD_PARTY_API_FAIL: 23,
  CACHE_CONNECTION_ERROR: 24,
} as const;
export const ExitCodesDescription = {
  0: 'Success',
  1: 'General error',
  20: 'Database connection error',
  21: 'Configuration missing',
  22: 'Invalid user input',
  23: 'Third party API failure',
  24: 'Cache connection error',
} as const;

export type ExitCodesDescription =
  (typeof ExitCodesDescription)[keyof typeof ExitCodesDescription];
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
