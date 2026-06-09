import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ModemManager } from '../modem/modem.manager';
import type { ModemRuntimeState } from '../modem/modem.types';
import { SendSmsDto } from './dto/send-sms.dto';
import { UpdateModemPhoneDto } from './dto/update-modem-phone.dto';

@ApiTags('modems')
@Controller('api/modems')
export class ModemStatusController {
  constructor(private readonly modemManager: ModemManager) {}

  @Get()
  @ApiOkResponse({
    description: 'List modem states for all configured COM ports',
  })
  listModems(): ModemRuntimeState[] {
    return this.modemManager.getAllStates();
  }

  @Get('summary')
  @ApiOkResponse({ description: 'Aggregated fleet status counters' })
  getSummary() {
    return this.modemManager.getFleetSummary();
  }

  @Get(':port')
  @ApiParam({ name: 'port', example: 'COM3' })
  @ApiOkResponse({ description: 'State of a single modem' })
  getModem(@Param('port') port: string): ModemRuntimeState {
    const state = this.modemManager.getState(port);
    if (!state) {
      throw new NotFoundException(`Unknown COM port: ${port}`);
    }
    return state;
  }

  @Patch(':port/phone')
  @ApiParam({ name: 'port', example: 'COM3' })
  @ApiOkResponse({ description: 'Assign SIM phone override and persist to modems.yaml' })
  updatePhone(
    @Param('port') port: string,
    @Body() body: UpdateModemPhoneDto,
  ): ModemRuntimeState {
    try {
      return this.modemManager.updatePortPhone(port, body.phone);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Phone update failed';
      if (message.includes('Unknown COM port')) {
        throw new NotFoundException(message);
      }
      throw new BadRequestException(message);
    }
  }

  @Post(':port/send-sms')
  @ApiParam({ name: 'port', example: 'COM3' })
  @ApiOkResponse({ description: 'Send an SMS through the given modem' })
  async sendSms(@Param('port') port: string, @Body() body: SendSmsDto) {
    try {
      return await this.modemManager.sendSms(port, body.phone, body.message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'SMS send failed';
      if (message.includes('Unknown COM port')) {
        throw new NotFoundException(message);
      }
      throw new ServiceUnavailableException(message);
    }
  }
}
