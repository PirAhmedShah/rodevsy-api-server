import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication, LogLevel, ValidationPipe } from '@nestjs/common';
import cookiesParser from 'cookie-parser';
import { ExpressAdapter } from '@nestjs/platform-express';
function getLoggerLevels(): LogLevel[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!isProduction && !isDevelopment)
    throw new Error(
      "FATAL: NODE_ENV enviroment variable must be either 'production' or 'development'!",
    );

  const PRODUCTION_LOG_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log'];
  const DEVELOPMENT_LOG_LEVELS: LogLevel[] = [
    ...PRODUCTION_LOG_LEVELS,
    'debug',
    'verbose',
  ];

  return isProduction ? PRODUCTION_LOG_LEVELS : DEVELOPMENT_LOG_LEVELS;
}

async function bootstrap() {
  const app: INestApplication<ExpressAdapter> = await NestFactory.create(
    AppModule,
    {
      logger: getLoggerLevels(),
    },
  );

  // main.ts
  // * Handled by Nginx Gateway...
  // app.enableCors({
  //   origin: 'http://localhost:3000',
  //   credentials: true,
  //   allowedHeaders: ['Content-Type', 'Authorization', 'Fingerprint'],
  // });
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
