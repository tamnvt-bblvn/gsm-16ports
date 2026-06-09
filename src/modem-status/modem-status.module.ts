import { Module } from '@nestjs/common';
import { ModemModule } from '../modem/modem.module';
import { ModemStatusController } from './modem-status.controller';

@Module({
  imports: [ModemModule],
  controllers: [ModemStatusController],
})
export class ModemStatusModule {}
