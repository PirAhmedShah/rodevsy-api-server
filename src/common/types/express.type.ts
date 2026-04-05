export type Cookie = string | undefined;
export type Secret = string | undefined;

export interface Request extends Express.Request {
  /**
   * This request's secret.
   * Optionally set by cookie-parser if secret(s) are provided.  Can be used by other middleware.
   * [Declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) can be used to add your own properties.
   */
  secret?: Secret;
  /** Parsed cookies that have not been signed */
  cookies?: Record<string, Cookie>;
  /** Parsed cookies that have been signed */
  signedCookies: Record<string, unknown>;
}
