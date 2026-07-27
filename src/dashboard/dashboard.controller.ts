import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Public } from '../common/decorators/public.decorator';

@Public()
@SkipThrottle()
@Controller()
export class DashboardController {
  @Get()
  serveDashboard(@Res() res: Response): void {
    res.sendFile(this.resolveAsset('index.html'));
  }

  @Get('dashboard-helpers.js')
  serveDashboardHelpers(@Res() res: Response): void {
    const filePath = this.resolveAsset('dashboard-helpers.js');
    res.type('application/javascript').send(fs.readFileSync(filePath, 'utf8'));
  }

  @Get('dashboard.js')
  serveDashboardJs(@Res() res: Response): void {
    const filePath = this.resolveAsset('dashboard.js');
    res.type('application/javascript').send(fs.readFileSync(filePath, 'utf8'));
  }

  @Get('dashboard.css')
  serveDashboardCss(@Res() res: Response): void {
    const filePath = this.resolveAsset('dashboard.css');
    res.type('text/css').send(fs.readFileSync(filePath, 'utf8'));
  }

  private resolveAsset(fileName: string): string {
    const distPath = path.join(__dirname, 'public', fileName);
    const srcPath = path.join(
      process.cwd(),
      'src',
      'dashboard',
      'public',
      fileName,
    );
    const isProd = process.env.NODE_ENV === 'production';
    const primary = isProd ? distPath : srcPath;
    const fallback = isProd ? srcPath : distPath;

    if (fs.existsSync(primary)) {
      return primary;
    }
    if (fs.existsSync(fallback)) {
      return fallback;
    }

    throw new NotFoundException(`Dashboard asset missing: ${fileName}`);
  }
}
