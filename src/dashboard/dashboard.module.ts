import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { DashboardController } from './dashboard.controller';
import { DashboardGateway } from './dashboard.gateway';

@Module({
  imports: [SmsModule],
  controllers: [DashboardController],
  providers: [DashboardGateway],
})
export class DashboardModule {}
