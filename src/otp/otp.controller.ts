import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { OtpService } from './otp.service';
import { DiscordWebhookService } from './discord-webhook.service';

@ApiTags('otp')
@Controller('api/otp')
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly discordWebhookService: DiscordWebhookService,
  ) {}

  @Public()
  @Get('discord-status')
  @ApiOkResponse({
    description: 'Whether the Discord webhook is configured and its last delivery result',
  })
  getDiscordStatus() {
    return this.discordWebhookService.getStatus();
  }

  @Public()
  @Post('discord-test')
  @ApiOkResponse({ description: 'Sends a sample embed to verify the Discord webhook' })
  async testDiscord() {
    const result = await this.discordWebhookService.sendTest();
    if (!result.ok) {
      throw new HttpException(
        result.reason ?? 'Gửi thử thất bại',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { ok: true };
  }

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
