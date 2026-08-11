import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export class SendSmsDto {
  @ApiProperty({ example: '0987654321', description: 'Recipient phone number' })
  @IsString({ message: 'Số điện thoại không hợp lệ' })
  @IsNotEmpty({ message: 'Vui lòng nhập số điện thoại' })
  // Allows short carrier/service codes (e.g. "191", "900", "1543" to
  // cancel/register a package), not just full-length phone numbers.
  @Matches(/^\+?\d{3,15}$/, {
    message:
      'Số điện thoại không hợp lệ (chỉ gồm chữ số, 3-15 số, có thể có dấu + ở đầu)',
  })
  phone!: string;

  @ApiProperty({ example: 'Your verification code is 123456' })
  @IsString({ message: 'Nội dung tin nhắn không hợp lệ' })
  @IsNotEmpty({ message: 'Vui lòng nhập nội dung tin nhắn' })
  @MaxLength(640, { message: 'Nội dung tin nhắn tối đa 640 ký tự' })
  message!: string;
}
