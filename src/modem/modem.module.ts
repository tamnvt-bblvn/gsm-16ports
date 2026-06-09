import { Module } from '@nestjs/common';
import { AtCommandService } from './at-command.service';
import { ModemManager } from './modem.manager';
import { SimInboxParser } from './sim-inbox.parser';
import { SmsParser } from './sms.parser';

@Module({
  providers: [AtCommandService, SmsParser, SimInboxParser, ModemManager],
  exports: [ModemManager, SmsParser],
})
export class ModemModule {}
