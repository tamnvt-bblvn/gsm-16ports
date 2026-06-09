import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ModemModule } from '../modem/modem.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, ModemModule],
  controllers: [HealthController],
})
export class HealthModule {}
