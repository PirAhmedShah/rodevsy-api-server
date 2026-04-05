// Src/db/db.enum.ts

export const PostgresErrorCode = {
  // Class 23 - Integrity Constraint Violation
  IntegrityConstraintViolation: '23000',
  RestrictViolation: '23001',
  NotNullViolation: '23502',
  ForeignKeyViolation: '23503',
  UniqueViolation: '23505',
  CheckViolation: '23514',
  ExclusionViolation: '23P01',

  // Class 42 - Syntax Error or Access Rule Violation
  UndefinedTable: '42P01',
  UndefinedColumn: '42703',
  SyntaxError: '42601',

  // Class 08 - Connection Exception
  ConnectionException: '08000',
  ConnectionFailure: '08006',

  // Class 42 - Insufficient Privilege (Used by your raise_exception() function)
  InsufficientPrivilege: '42501',
} as const;

export type PostgresErrorCodeType =
  (typeof PostgresErrorCode)[keyof typeof PostgresErrorCode];
