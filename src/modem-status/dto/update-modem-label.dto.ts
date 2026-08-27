import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class UpdateModemLabelDto {
  @ApiProperty({
    example: 'Khe 01',
    description: 'Nhãn vị trí vật lý do người vận hành tự đặt cho cổng COM',
  })
  @IsString()
  @Length(1, 40)
  label!: string;
}
