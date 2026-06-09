import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ModemManager } from '../modem/modem.manager';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('api/health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthIndicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly modemManager: ModemManager,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOkResponse({
    description: 'Liveness/readiness check (database + modems)',
  })
  check() {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.checkModems(),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicator.check('database');
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'database unreachable';
      return indicator.down({ message });
    }
  }

  private checkModems(): HealthIndicatorResult {
    const summary = this.modemManager.getFleetSummary();
    const indicator = this.healthIndicator.check('modems');
    return indicator.up(summary);
  }
}
