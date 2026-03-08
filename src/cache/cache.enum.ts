export const CachePrefix = {
  REFRESH_TOKEN: 'refresh_token',
} as const;

export type CachePrefix = (typeof CachePrefix)[keyof typeof CachePrefix];
