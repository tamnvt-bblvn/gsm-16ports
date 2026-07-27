import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { SmsService } from './sms.service';

/** Dashboard inbox — reachable without API key when auth is enabled. */
@Public()
@ApiTags('messages')
@Controller('api/messages')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Paginated, searchable list of received SMS messages',
  })
  listMessages(@Query() query: QueryMessagesDto) {
    return this.smsService.searchMessages({
      page: query.page,
      pageSize: query.pageSize,
      port: query.port,
      phone: query.phone,
      search: query.search,
      onlyOtp: query.onlyOtp,
    });
  }
}
