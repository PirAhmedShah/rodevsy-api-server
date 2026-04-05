import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Cookie, Request } from '@/common/types';

export const Cookies = createParamDecorator(
  (data: Cookie, ctx: ExecutionContext): Record<string, Cookie> | Cookie => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const cookies = request.cookies;

    if (!cookies) return undefined;

    return data ? cookies[data] : cookies;
  },
);
