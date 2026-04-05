export const CachePrefix = {
  REFRESH_TOKEN: 'refresh_token',
} as const;

export const JwtAudience = {
  API: 'API',
  TEST: 'TEST',
} as const;

export const JwtType = {
  ACCESS: 'A',
  REFRESH: 'R',
} as const;

export type JwtType = (typeof JwtType)[keyof typeof JwtType];
export type CachePrefix = (typeof CachePrefix)[keyof typeof CachePrefix];
export type JwtAudience = (typeof JwtAudience)[keyof typeof JwtAudience];
