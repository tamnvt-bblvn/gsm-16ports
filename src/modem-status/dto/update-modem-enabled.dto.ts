import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateModemEnabledDto {
  @ApiProperty({
    example: true,
    description: 'Enable or disable monitoring for this COM port',
  })
  @IsBoolean()
  enabled!: boolean;
}
