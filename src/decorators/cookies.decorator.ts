import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Cookie } from 'src/auth/auth.type';

export const Cookies = createParamDecorator(
  (data: Cookie, ctx: ExecutionContext): Record<string, Cookie> | Cookie => {
    const request = ctx.switchToHttp().getRequest<Request>();

    // Cast cookies to a record to avoid 'any' member access
    const cookies = request.cookies as Record<string, Cookie>;
    console.log('COOKIES: ', cookies, ' DATA ', data);
    if (!cookies) {
      return undefined;
    }

    return data ? cookies[data] : cookies;
  },
);
