import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import {
  OTP_RECEIVED_EVENT,
  SMS_RECEIVED_EVENT,
} from '../common/events/app.events';
import type { SmsReceivedPayload } from '../common/events/app.events';
import { correctStoredGsmDate } from '../common/utils/gsm-timestamp.util';
import { decodeSmsBody, isUcs2HexBody } from '../common/utils/sms-body.util';
import { normalizePhone } from '../common/utils/phone.util';
import { ModemManager } from '../modem/modem.manager';
import { OtpExtractor } from '../otp/otp.extractor';
import { PrismaService } from '../prisma/prisma.service';

export interface SmsMessageDto {
  id: string;
  modemPort: string;
  sender: string | null;
  phoneNumber: string | null;
  message: string;
  otpCode: string | null;
  receivedAt: string;
  createdAt: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface SearchMessagesOptions {
  page?: number;
  pageSize?: number;
  port?: string;
  phone?: string;
  search?: string;
  onlyOtp?: boolean;
}

@Injectable()
export class SmsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpExtractor: OtpExtractor,
    private readonly modemManager: ModemManager,
    private readonly eventEmitter: EventEmitter2,
    @InjectPinoLogger(SmsService.name)
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    void this.runStartupBackfills();
  }

  private async runStartupBackfills(): Promise<void> {
    await this.backfillHexMessages();
    await this.backfillMisParsedTimestamps();
    await this.backfillOtpCodes();
  }

  @OnEvent(SMS_RECEIVED_EVENT)
  async handleIncomingSms(payload: SmsReceivedPayload): Promise<void> {
    const modemState = this.modemManager.getState(payload.port);
    const simPhone = modemState?.phone ?? null;
    const sender = payload.sender?.trim() || '';
    const rawMessage = payload.message.trim();
    const message = decodeSmsBody(rawMessage);
    const otpCode = this.otpExtractor.extract(message);

    const existing = await this.prisma.smsMessage.findFirst({
      where: {
        modemPort: payload.port,
        sender,
        OR: [
          { receivedAt: payload.receivedAt },
          { message: rawMessage },
          ...(message !== rawMessage ? [{ message }] : []),
        ],
      },
    });

    if (existing) {
      const updates: { message?: string; otpCode?: string | null; receivedAt?: Date } =
        {};

      if (existing.message !== message && isUcs2HexBody(existing.message)) {
        updates.message = message;
        updates.otpCode = otpCode ?? existing.otpCode;
      }

      const correctedExisting = correctStoredGsmDate(existing.receivedAt);
      if (correctedExisting) {
        updates.receivedAt = correctedExisting;
      } else if (
        payload.receivedAt &&
        existing.receivedAt.getTime() !== payload.receivedAt.getTime() &&
        payload.receivedAt.getFullYear() >= 2020 &&
        payload.receivedAt.getFullYear() <= 2030
      ) {
        updates.receivedAt = payload.receivedAt;
      }

      if (Object.keys(updates).length > 0) {
        const upgraded = await this.applyExistingRecordUpdates(
          existing,
          updates,
          payload.port,
          sender,
        );
        if (upgraded) {
          this.logger.debug(
            { port: payload.port, id: existing.id.toString() },
            'sms.record_upgraded',
          );
        }
      } else {
        this.logger.debug(
          {
            port: payload.port,
            sender,
            source: payload.source ?? 'realtime',
          },
          'sms.duplicate_skipped',
        );
      }
      return;
    }

    let saved;
    try {
      saved = await this.prisma.smsMessage.create({
        data: {
          modemPort: payload.port,
          sender,
          phoneNumber: simPhone,
          message,
          otpCode,
          receivedAt: payload.receivedAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.debug(
          {
            port: payload.port,
            sender,
            source: payload.source ?? 'realtime',
          },
          'sms.duplicate_skipped',
        );
        return;
      }
      throw error;
    }

    this.logger.info(
      {
        port: payload.port,
        sender,
        otp: otpCode,
        source: payload.source ?? 'realtime',
      },
      'sms.persisted',
    );

    if (otpCode) {
      this.eventEmitter.emit(OTP_RECEIVED_EVENT, {
        port: payload.port,
        phone: simPhone,
        otp: otpCode,
        message,
        receivedAt: payload.receivedAt,
        smsId: saved.id.toString(),
      });
    }
  }

  async findMessages(options: {
    limit?: number;
    port?: string;
    phone?: string;
  }): Promise<SmsMessageDto[]> {
    const limit = Math.min(options.limit ?? 50, 200);
    const where: {
      modemPort?: string;
      phoneNumber?: string;
    } = {};

    if (options.port) {
      where.modemPort = options.port;
    }

    if (options.phone) {
      const normalized = normalizePhone(options.phone);
      if (normalized) {
        where.phoneNumber = normalized;
      }
    }

    const rows = await this.prisma.smsMessage.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => this.toDto(row));
  }

  async searchMessages(
    options: SearchMessagesOptions,
  ): Promise<PaginatedResult<SmsMessageDto>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 25), 200);

    const where: Prisma.SmsMessageWhereInput = {};

    if (options.port) {
      where.modemPort = options.port;
    }

    if (options.phone) {
      const normalized = normalizePhone(options.phone);
      if (normalized) {
        where.phoneNumber = normalized;
      }
    }

    if (options.onlyOtp) {
      where.otpCode = { not: null };
    }

    if (options.search?.trim()) {
      const term = options.search.trim();
      where.OR = [
        { message: { contains: term, mode: 'insensitive' } },
        { sender: { contains: term, mode: 'insensitive' } },
        { otpCode: { contains: term } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.smsMessage.count({ where }),
      this.prisma.smsMessage.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toDto(row)),
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async findLatestOtpByPort(port: string): Promise<{
    port: string;
    otp: string;
    receivedAt: string;
  } | null> {
    const row = await this.prisma.smsMessage.findFirst({
      where: {
        modemPort: port,
        otpCode: { not: null },
      },
      orderBy: { receivedAt: 'desc' },
    });

    if (!row?.otpCode) {
      return null;
    }

    return {
      port,
      otp: row.otpCode,
      receivedAt: row.receivedAt.toISOString(),
    };
  }

  async findLatestOtpByPhone(phone: string): Promise<{
    phone: string;
    otp: string;
    receivedAt: string;
  } | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return null;
    }

    const row = await this.prisma.smsMessage.findFirst({
      where: {
        phoneNumber: normalized,
        otpCode: { not: null },
      },
      orderBy: { receivedAt: 'desc' },
    });

    if (!row?.otpCode) {
      return null;
    }

    return {
      phone: normalized,
      otp: row.otpCode,
      receivedAt: row.receivedAt.toISOString(),
    };
  }

  private async applyExistingRecordUpdates(
    existing: {
      id: bigint;
      message: string;
      otpCode: string | null;
      receivedAt: Date;
    },
    updates: { message?: string; otpCode?: string | null; receivedAt?: Date },
    modemPort: string,
    sender: string,
  ): Promise<boolean> {
    const message = updates.message ?? existing.message;

    if (updates.receivedAt) {
      const conflict = await this.prisma.smsMessage.findFirst({
        where: {
          modemPort,
          sender,
          message,
          receivedAt: updates.receivedAt,
          NOT: { id: existing.id },
        },
      });

      if (conflict) {
        const conflictUpdates: { message?: string; otpCode?: string | null } =
          {};
        if (updates.message && conflict.message !== updates.message) {
          conflictUpdates.message = updates.message;
        }
        if (updates.otpCode && !conflict.otpCode) {
          conflictUpdates.otpCode = updates.otpCode;
        }
        if (Object.keys(conflictUpdates).length > 0) {
          await this.prisma.smsMessage.update({
            where: { id: conflict.id },
            data: conflictUpdates,
          });
        }

        await this.prisma.smsMessage.delete({ where: { id: existing.id } });
        this.logger.debug(
          {
            port: modemPort,
            removedId: existing.id.toString(),
            keptId: conflict.id.toString(),
          },
          'sms.duplicate_merged',
        );
        return true;
      }
    }

    try {
      await this.prisma.smsMessage.update({
        where: { id: existing.id },
        data: updates,
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const { receivedAt: _ignored, ...withoutDate } = updates;
        if (Object.keys(withoutDate).length === 0) {
          this.logger.debug(
            { port: modemPort, id: existing.id.toString() },
            'sms.timestamp_upgrade_duplicate_skipped',
          );
          return false;
        }

        await this.prisma.smsMessage.update({
          where: { id: existing.id },
          data: withoutDate,
        });
        return true;
      }
      throw error;
    }
  }

  private async backfillHexMessages(): Promise<void> {
    const recent = await this.prisma.smsMessage.findMany({
      orderBy: { id: 'desc' },
      take: 500,
    });

    let upgraded = 0;
    for (const row of recent) {
      if (!isUcs2HexBody(row.message)) {
        continue;
      }

      const decoded = decodeSmsBody(row.message);
      const otpCode =
        row.otpCode ?? this.otpExtractor.extract(decoded) ?? null;

      await this.prisma.smsMessage.update({
        where: { id: row.id },
        data: { message: decoded, otpCode },
      });
      upgraded += 1;
    }

    if (upgraded > 0) {
      this.logger.info({ upgraded }, 'sms.hex_backfill_completed');
    }
  }

  private async backfillMisParsedTimestamps(): Promise<void> {
    const candidates = await this.prisma.smsMessage.findMany({
      where: {
        OR: [
          { receivedAt: { gte: new Date('2028-01-01') } },
          {
            receivedAt: {
              gte: new Date('2027-01-01'),
              lt: new Date('2028-01-01'),
            },
          },
          {
            receivedAt: {
              gte: new Date('2000-01-01'),
              lt: new Date('2016-01-01'),
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
    });

    let fixed = 0;
    for (const row of candidates) {
      const corrected = correctStoredGsmDate(row.receivedAt);
      if (!corrected) {
        continue;
      }

      try {
        await this.prisma.smsMessage.update({
          where: { id: row.id },
          data: { receivedAt: corrected },
        });
        fixed += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          this.logger.debug(
            { id: row.id.toString() },
            'sms.timestamp_backfill_duplicate_skipped',
          );
          continue;
        }
        throw error;
      }
    }

    if (fixed > 0) {
      this.logger.info({ fixed }, 'sms.timestamp_backfill_completed');
    }
  }

  private async backfillOtpCodes(): Promise<void> {
    const recent = await this.prisma.smsMessage.findMany({
      orderBy: { id: 'desc' },
      take: 1000,
    });

    let updated = 0;
    for (const row of recent) {
      const message = decodeSmsBody(row.message);
      const otpCode = this.otpExtractor.extract(message);
      if (otpCode === row.otpCode) {
        continue;
      }

      await this.prisma.smsMessage.update({
        where: { id: row.id },
        data: { otpCode },
      });
      updated += 1;
    }

    if (updated > 0) {
      this.logger.info({ updated }, 'sms.otp_backfill_completed');
    }
  }

  private toDto(row: {
    id: bigint;
    modemPort: string;
    sender: string | null;
    phoneNumber: string | null;
    message: string;
    otpCode: string | null;
    receivedAt: Date;
    createdAt: Date;
  }): SmsMessageDto {
    const message = decodeSmsBody(row.message);
    const otpCode = this.otpExtractor.extract(message);
    return {
      id: row.id.toString(),
      modemPort: row.modemPort,
      sender: row.sender,
      phoneNumber: row.phoneNumber,
      message,
      otpCode,
      receivedAt: row.receivedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
