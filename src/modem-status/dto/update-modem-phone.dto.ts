import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class UpdateModemPhoneDto {
  @ApiProperty({
    example: '0924033230',
    description: 'Số SIM gán thủ công cho cổng COM (0xxxxxxxxx)',
  })
  @IsString()
  @Matches(/^0\d{9,10}$/, {
    message: 'phone must be a Vietnamese mobile number starting with 0',
  })
  phone!: string;
}
