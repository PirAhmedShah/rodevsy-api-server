import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { SilentLogger } from './common/utils';

describe('AppService', () => {
  let service: AppService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    })
      .setLogger(SilentLogger)
      .compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns OK', () => {
    expect(service.getOK()).toBe('OK');
  });
});
