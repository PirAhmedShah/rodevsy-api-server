import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  constructor() {
    this.logger.debug('Constructed.');
  }

  extractRequestInfo(req: Express.Request, ipFromDecorator: string) {
    return {
      // ---- IP RELATED ----
      ip_decorator: ipFromDecorator, // Nest resolved IP
      req_ip: req.ip, // Express resolved IP
      x_forwarded_for: req.headers['x-forwarded-for'],
      x_real_ip: req.headers['x-real-ip'],
      remote_address: req.socket.remoteAddress,

      // ---- NETWORK ----
      protocol: req.protocol,
      hostname: req.hostname,
      method: req.method,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,

      // ---- HEADERS ----
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
      contentType: req.headers['content-type'],
      authorization: req.headers['authorization'] ? 'present' : null,

      // ---- CONNECTION ----
      httpVersion: req.httpVersion,
      secure: req.secure,
      xhr: req.xhr,

      // ---- COOKIES ----
      cookies: req.cookies,
      signedCookies: req.signedCookies,

      // ---- QUERY & PARAMS ----
      query: req.query,
      params: req.params,

      // ---- TIMING ----
      timestamp: new Date().toISOString(),
    };
  }

  getOK(): string {
    return 'OK';
  }
}
