export interface ILoginLog {
  userId: string;
  ip: string;
  fingerprint: string;
  success: boolean;
  userAgent: string;
  used2fa: boolean;
  jti: string | null;
}

export type Cookie = string | undefined;
