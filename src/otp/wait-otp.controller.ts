import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { WaitOtpDto } from './dto/wait-otp.dto';
import { WaitOtpService } from './wait-otp.service';

@ApiTags('otp')
@Controller('api/wait-otp')
export class WaitOtpController {
  constructor(private readonly waitOtpService: WaitOtpService) {}

  @Post()
  @ApiBody({ type: WaitOtpDto })
  @ApiOkResponse({ description: 'Wait until a new OTP arrives' })
  async waitForOtp(@Body() body: WaitOtpDto) {
    if (!body.port && !body.phone) {
      throw new BadRequestException('Either port or phone is required');
    }

    try {
      return await this.waitOtpService.waitForOtp({
        port: body.port,
        phone: body.phone,
        timeout: body.timeout ?? 60,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OTP wait failed';
      throw new HttpException(message, HttpStatus.REQUEST_TIMEOUT);
    }
  }
}
