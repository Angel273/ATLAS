import { Controller, Get, Post, Body, Param, Req, Res, Headers, Inject, Query } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../identity/auth.service.js';
import { WorkforceService } from './workforce.service.js';

function token(request: Request): string {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return request.cookies?.atlas_session ?? '';
}

@Controller('workforce')
export class WorkforceController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(WorkforceService) private readonly service: WorkforceService,
  ) {}

  @Get('employee-types')
  async listEmployeeTypes(@Req() request: Request) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.listEmployeeTypes(actor);
  }

  @Post('employee-types')
  async createEmployeeType(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.createEmployeeType(actor, body, key, String(response.locals.correlationId));
  }

  @Get('teams')
  async listTeams(@Req() request: Request) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.listTeams(actor);
  }

  @Post('teams')
  async createTeam(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.createTeam(actor, body, key, String(response.locals.correlationId));
  }

  @Get('employees')
  async listEmployees(
    @Req() request: Request,
    @Query('teamId') teamId?: string,
    @Query('search') search?: string,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.listEmployees(actor, { teamId, search });
  }

  @Get('employees/:id')
  async getEmployee(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.getEmployee(actor, id);
  }

  @Post('employees')
  async createEmployee(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.createEmployee(actor, body, key, String(response.locals.correlationId));
  }

  @Get('employees/:id/assignments')
  async listAssignments(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.listAssignments(actor, id);
  }

  @Post('assignments')
  async createAssignment(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.createAssignment(actor, body, key, String(response.locals.correlationId));
  }

  @Get('employees/:id/relationships')
  async listRelationships(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.listRelationships(actor, id);
  }

  @Post('relationships')
  async createRelationship(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.createRelationship(actor, body, key, String(response.locals.correlationId));
  }
}
