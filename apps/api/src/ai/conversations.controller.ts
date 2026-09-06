import { Controller, Get, Post, Body, Param, Req, Res, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../identity/auth.service.js';
import { ConversationsService } from './conversations.service.js';

function token(request: Request): string {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return request.cookies?.atlas_session ?? '';
}

@Controller('conversations')
export class ConversationsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConversationsService) private readonly service: ConversationsService,
  ) {}

  @Get()
  async list(@Req() request: Request) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.list(actor);
  }

  @Post()
  async create(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.create(actor, body, String(response.locals.correlationId));
  }

  @Get('info/model')
  async getModelInfo(@Req() request: Request) {
    await this.auth.authenticate(token(request));
    return this.service.getModelInfo();
  }

  @Get(':id')
  async get(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.get(actor, id);
  }

  @Post(':id/messages')
  async sendMessage(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.sendMessage(actor, id, body, String(response.locals.correlationId));
  }
}
