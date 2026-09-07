/**
 * @file apps/api/src/workforce/workforce.controller.ts
 * @description Controlador HTTP REST (/api/v1/workforce) para el módulo de Workforce / Agent Definer.
 * Expone rutas protegidas para la administración de semanas operativas (listado, generación anual, estado actual),
 * empleados, equipos de trabajo, asignaciones vigentes, jerarquías laborales, importación masiva de rosters
 * y descarga streaming de plantillas Excel.
 */

import { Controller, Get, Post, Patch, Body, Param, Req, Res, Headers, Inject, Query } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../identity/auth.service.js';
import { WorkforceService } from './workforce.service.js';

/**
 * Extrae el token de autenticación de la cabecera `Authorization: Bearer <token>` o de las cookies HTTP.
 *
 * @param request Objeto de solicitud Express.
 * @returns Token opaco de sesión.
 */
function token(request: Request): string {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return request.cookies?.atlas_session ?? '';
}

/**
 * Controlador NestJS para operaciones y endpoints de Workforce.
 */
@Controller('workforce')
export class WorkforceController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(WorkforceService) private readonly service: WorkforceService,
  ) {}


  // --- Weeks ---

  @Get('weeks')
  async listWeeks(
    @Req() request: Request,
    @Query('year') year?: string,
    @Query('status') status?: string,
  ) {
    const actor = await this.auth.authenticate(token(request));
    const yearNumber = year ? parseInt(year, 10) : undefined;
    return this.service.listWeeks(actor, { yearNumber, status });
  }

  @Get('weeks/current')
  async getCurrentWeek(@Req() request: Request) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.getCurrentWeek(actor);
  }

  @Post('weeks')
  async createWeek(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.createWeek(actor, body, key, String(response.locals.correlationId));
  }

  @Patch('weeks/:id')
  async updateWeek(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.updateWeek(actor, id, body, String(response.locals.correlationId));
  }

  @Post('weeks/generate-year')
  async generateYearWeeks(
    @Req() request: Request,
    @Body('year') year: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    const targetYear = typeof year === 'number' ? year : new Date().getUTCFullYear();
    return this.service.generateYearWeeks(actor, targetYear, String(response.locals.correlationId));
  }

  // --- Employee Types ---

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

  // --- Teams ---

  @Get('teams')
  async listTeams(@Req() request: Request) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.listTeams(actor);
  }

  @Get('teams/template')
  async getTeamTemplate(@Req() request: Request, @Res() response: Response) {
    const actor = await this.auth.authenticate(token(request));
    const buffer = await this.service.getTeamTemplate(actor);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="plantilla_equipos_workforce.xlsx"');
    response.setHeader('Content-Length', buffer.length);
    response.end(buffer);
  }

  @Post('teams/import-excel')
  async importTeamsFromExcel(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.importTeamsFromExcel(actor, body, String(response.locals.correlationId));
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

  // --- Employees ---

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

  // --- Assignments ---

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

  // --- Relationships ---

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

  // --- Roster Versions & Weekly Operations ---

  @Get('weeks/:weekId/rosters')
  async listRosterVersions(@Req() request: Request, @Param('weekId') weekId: string) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.listRosterVersions(actor, weekId);
  }

  @Get('roster-versions/:versionId/entries')
  async getRosterEntries(@Req() request: Request, @Param('versionId') versionId: string) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.getRosterEntries(actor, versionId);
  }

  @Post('roster-versions/:versionId/publish')
  async publishRosterVersion(
    @Req() request: Request,
    @Param('versionId') versionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.publishRosterVersion(actor, versionId, String(response.locals.correlationId));
  }

  @Post('weeks/:weekId/clone-roster')
  async cloneWeekRoster(
    @Req() request: Request,
    @Param('weekId') weekId: string,
    @Body() body: { sourceWeekId: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.auth.authenticate(token(request));
    return this.service.cloneWeekRoster(actor, body.sourceWeekId, weekId, String(response.locals.correlationId));
  }
}
