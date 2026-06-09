import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OtpService } from './otp.service';

@ApiTags('otp')
@Controller('api/otp')
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Get('latest')
  @ApiQuery({ name: 'phone', required: false, type: String })
  @ApiQuery({ name: 'port', required: false, type: String })
  @ApiOkResponse({ description: 'Latest OTP by phone or COM port' })
  async getLatest(
    @Query('phone') phone?: string,
    @Query('port') port?: string,
  ) {
    if (!phone && !port) {
      throw new BadRequestException(
        'Either phone or port query param is required',
      );
    }

    if (phone && port) {
      throw new BadRequestException('Provide only one of phone or port');
    }

    if (port) {
      const result = await this.otpService.getLatestByPort(port);
      if (!result) {
        throw new HttpException('OTP not found', HttpStatus.NOT_FOUND);
      }
      return result;
    }

    const result = await this.otpService.getLatestByPhone(phone!);
    if (!result) {
      throw new HttpException('OTP not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }
}
