import { LoggerService } from '@nestjs/common';

/*Silent logger for testing*/
export const SilentLogger: LoggerService = {
  log: () => {
    /* empty */
  },
  error: () => {
    /* empty */
  },
  warn: () => {
    /* empty */
  },
  debug: () => {
    /* empty */
  },
  verbose: () => {
    /* empty */
  },
  fatal: () => {
    /* empty */
  },
};
