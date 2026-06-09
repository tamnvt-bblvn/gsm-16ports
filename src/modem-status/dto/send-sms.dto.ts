import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export class SendSmsDto {
  @ApiProperty({ example: '0987654321', description: 'Recipient phone number' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{6,15}$/, { message: 'phone must be a valid phone number' })
  phone!: string;

  @ApiProperty({ example: 'Your verification code is 123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(640)
  message!: string;
}
