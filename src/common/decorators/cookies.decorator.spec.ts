import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Cookies } from './cookies.decorator';

// Define the structure NestJS uses internally for param decorators
interface ParamDecoratorMetadata {
  index: number;
  factory: (data: unknown, ctx: ExecutionContext) => unknown;
  data?: unknown;
}

function getDecoratorFactory(decorator: ParameterDecorator) {
  class TestClass {
    // 1. Prefix unused 'value' with '_'
    // 2. Add a comment to the empty body
    public test(@decorator _value: unknown) {
      /* logic handled by metadata */
    }
  }

  // Cast the metadata to a Record to allow safe member access
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestClass,
    'test',
  ) as Record<string, ParamDecoratorMetadata>;

  const firstKey = Object.keys(args)[0];
  return args[firstKey].factory;
}

describe('CookiesDecorator', () => {
  // Define the function signature instead of using 'any'
  let factory: (data: unknown, ctx: ExecutionContext) => unknown;

  beforeAll(() => {
    factory = getDecoratorFactory(Cookies());
  });

  it('should return a specific cookie if a key is provided', () => {
    const mockCookieName = 'refreshToken';
    const mockCookieValue = 'valid.jwt.token';

    // Cast through unknown to satisfy the ExecutionContext type
    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          cookies: {
            [mockCookieName]: mockCookieValue,
            otherCookie: 'someValue',
          },
        }),
      }),
    } as unknown as ExecutionContext;

    const result = factory(mockCookieName, mockExecutionContext);

    expect(result).toBe(mockCookieValue);
  });

  it('should return all cookies if no key is provided', () => {
    const mockCookies = {
      refreshToken: 'valid.jwt.token',
      sessionId: '123456',
    };

    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          cookies: mockCookies,
        }),
      }),
    } as unknown as ExecutionContext;

    const result = factory(undefined, mockExecutionContext);

    expect(result).toEqual(mockCookies);
  });

  it('should return undefined if cookies object does not exist on request', () => {
    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          // Explicitly missing cookies
        }),
      }),
    } as unknown as ExecutionContext;

    const result = factory('someCookie', mockExecutionContext);

    expect(result).toBeUndefined();
  });
});
