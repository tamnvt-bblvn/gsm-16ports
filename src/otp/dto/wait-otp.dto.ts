import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class WaitOtpDto {
  @ApiPropertyOptional({ example: 'COM19' })
  @IsOptional()
  @IsString()
  port?: string;

  @ApiPropertyOptional({ example: '0987654321' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 60, default: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  timeout?: number;
}
