import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  SIM_ICCID_OBSERVED_EVENT,
  SIM_PORT_CHANGED_EVENT,
} from '../common/events/app.events';
import type { SimIccidObservedPayload } from '../common/events/app.events';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tracks which port each SIM (by ICCID) was last seen on, persisted across
 * app restarts. When a known SIM shows up on a different port than last
 * recorded, that's a device change from the carrier's point of view
 * (each modem port is a distinct IMEI) — which, since 15/6/2026, requires
 * re-authenticating face biometrics within 2h or the line gets locked.
 */
@Injectable()
export class SimPortHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectPinoLogger(SimPortHistoryService.name)
    private readonly logger: PinoLogger,
  ) {}

  @OnEvent(SIM_ICCID_OBSERVED_EVENT)
  async handleIccidObserved(payload: SimIccidObservedPayload): Promise<void> {
    try {
      await this.recordAndCheck(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        { err: message, port: payload.port },
        'sim_port_history.check_failed',
      );
    }
  }

  private async recordAndCheck(
    payload: SimIccidObservedPayload,
  ): Promise<void> {
    const existing = await this.prisma.simIccidHistory.findUnique({
      where: { iccid: payload.iccid },
    });

    if (!existing) {
      await this.prisma.simIccidHistory.create({
        data: {
          iccid: payload.iccid,
          lastPort: payload.port,
          phone: payload.phone,
        },
      });
      return;
    }

    if (existing.lastPort === payload.port) {
      await this.prisma.simIccidHistory.update({
        where: { iccid: payload.iccid },
        data: { phone: payload.phone ?? existing.phone },
      });
      return;
    }

    const previousPort = existing.lastPort;
    const previousSeenAt = existing.lastSeenAt;
    const detectedAt = new Date();

    await this.prisma.simIccidHistory.update({
      where: { iccid: payload.iccid },
      data: { lastPort: payload.port, phone: payload.phone ?? existing.phone },
    });

    this.logger.warn(
      {
        iccid: payload.iccid,
        previousPort,
        newPort: payload.port,
      },
      'sim_port_history.port_changed',
    );

    this.eventEmitter.emit(SIM_PORT_CHANGED_EVENT, {
      iccid: payload.iccid,
      previousPort,
      newPort: payload.port,
      phone: payload.phone,
      previousSeenAt,
      detectedAt,
    });
  }
}
