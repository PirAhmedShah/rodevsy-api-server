export const JwtType = {
  ACCESS: 'A',
  REFRESH: 'R',
} as const;

export type JwtType = (typeof JwtType)[keyof typeof JwtType];

export const JwtAudience = {
  /** * The primary audience. The API server verifies that the token
   * was intended for "API" use before processing the request.
   */
  API: 'API',
} as const;

export type JwtAudience = (typeof JwtAudience)[keyof typeof JwtAudience];
export interface JwtSignResponse {
  token: string;
  jti: string;
}
