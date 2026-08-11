import { Module } from '@nestjs/common';
import { AtCommandService } from './at-command.service';
import { ModemManager } from './modem.manager';
import { SimInboxParser } from './sim-inbox.parser';
import { SimPortHistoryService } from './sim-port-history.service';
import { SmsParser } from './sms.parser';

@Module({
  providers: [
    AtCommandService,
    SmsParser,
    SimInboxParser,
    ModemManager,
    SimPortHistoryService,
  ],
  exports: [ModemManager, SmsParser, AtCommandService],
})
export class ModemModule {}
