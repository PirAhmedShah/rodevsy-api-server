import { Injectable, Logger } from '@nestjs/common';
// import type { Request } from 'express';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  constructor() {
    this.logger.debug('Constructed.');
  }

  // ExtractRequestInfo(req: Request, ipFromDecorator: string) {
  //   Return {
  //     // ---- IP RELATED ----
  //     Ip_decorator: ipFromDecorator, // Nest resolved IP
  //     Req_ip: req.ip, // Express resolved IP
  //     X_forwarded_for: req.headers['x-forwarded-for'],
  //     X_real_ip: req.headers['x-real-ip'],
  //     Remote_address: req.socket.remoteAddress,

  //     // ---- NETWORK ----
  //     Protocol: req.protocol,
  //     Hostname: req.hostname,
  //     Method: req.method,
  //     OriginalUrl: req.originalUrl,
  //     BaseUrl: req.baseUrl,
  //     Path: req.path,

  //     // ---- HEADERS ----
  //     UserAgent: req.headers['user-agent'],
  //     Referer: req.headers['referer'],
  //     ContentType: req.headers['content-type'],
  //     Authorization: req.headers['authorization'] ? 'present' : null,

  //     // ---- CONNECTION ----
  //     HttpVersion: req.httpVersion,
  //     Secure: req.secure,
  //     Xhr: req.xhr,

  //     // ---- COOKIES ----
  //     Cookies: req.cookies,
  //     SignedCookies: req.signedCookies,

  //     // ---- QUERY & PARAMS ----
  //     Query: req.query as Record<string, unknown>,
  //     Params: req.params as Record<string, unknown>,

  //     // ---- TIMING ----
  //     Timestamp: new Date().toISOString(),
  //   };
  // }

  getOK(): string {
    return 'OK';
  }
}
