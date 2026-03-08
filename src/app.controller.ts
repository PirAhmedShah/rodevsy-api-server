import { All, Controller, Get, Ip, Req } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/whoami')
  getInfo(@Req() req: Request, @Ip() ip: string) {
    return this.appService.extractRequestInfo(req, ip);
  }
  @All()
  getOK(): string {
    return this.appService.getOK();
  }
}
