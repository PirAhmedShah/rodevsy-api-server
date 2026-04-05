import { LoggerService } from '@nestjs/common';

/*Silent logger for testing*/
export const SilentLogger: LoggerService = {
  log: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  verbose: () => {},
  fatal: () => {},
};
