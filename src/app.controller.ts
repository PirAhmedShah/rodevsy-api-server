import { All, Controller } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // @Get('/whoami')
  // GetInfo(@Req() req: Request, @Ip() ip: string) {
  //   Return this.appService.extractRequestInfo(req, ip);
  // }
  @All()
  getOK(): string {
    return this.appService.getOK();
  }
}
