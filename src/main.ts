import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication, LogLevel, ValidationPipe } from '@nestjs/common';
import cookiesParser from 'cookie-parser';
import { ExpressAdapter } from '@nestjs/platform-express';
function getLoggerLevels(): LogLevel[] {
  const isProduction = process.env.NODE_ENV === 'production',
    isDevelopment = process.env.NODE_ENV === 'development',
    isTest = process.env.NODE_ENV === 'test';

  if (!isProduction && !isDevelopment && !isTest)
    throw new Error(
      `FATAL: NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} is INVALID. It must be either 'production', 'test' or 'development'`,
    );

  const PRODUCTION_LOG_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log'],
    DEVELOPMENT_LOG_LEVELS: LogLevel[] = [
      ...PRODUCTION_LOG_LEVELS,
      'debug',
      'verbose',
    ];

  return isProduction
    ? PRODUCTION_LOG_LEVELS
    : isDevelopment
      ? DEVELOPMENT_LOG_LEVELS
      : [];
}

async function bootstrap() {
  const app: INestApplication<ExpressAdapter> = await NestFactory.create(
    AppModule,
    {
      logger: getLoggerLevels(),
    },
  );

  app.use(cookiesParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();
  (app.getHttpAdapter().getInstance() as ExpressAdapter).set('trust proxy', 1);
  await app.listen(process.env.PORT ?? 8000);
}
void bootstrap();
