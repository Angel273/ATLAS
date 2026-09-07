/**
 * @file apps/api/src/app.ts
 * @description Configuración central del módulo NestJS, middleware de seguridad y controladores REST principales (@atlas/api).
 * Configura:
 * - Helmet para cabeceras HTTP seguras, cookies HTTP-only con prefijo `__Host-` en producción y SameSite strict.
 * - Inyección de correlationId para trazabilidad de logs sin filtrar datos personales.
 * - Controladores principales: Foundation (health/features), Auth (login, MFA, perfil), Semantic (relaciones, KPIs, queries),
 *   Datasets (ciclo de vida, subidas S3, mapeo) y Dashboards (versiones, filtros operacionales).
 * - Fábrica `createApp` para instanciación de la aplicación en producción y tests de integración.
 */

import 'reflect-metadata';
import { Controller, Get, Post, Patch, Delete, Put, Body, Req, Res, Param, Headers, Inject, Module, HttpCode, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import {
  foundationFeatures, healthSchema, loginSchema, totpSchema, sessionSchema, loginResultSchema,
  mfaSetupSchema, createAccountSchema, updateAccountSchema, deleteAccountResultSchema, updateRoleSchema, updateRoleResultSchema,
  createUserSchema, createUserResultSchema, removeMemberResultSchema,
  userProfileSchema, updateProfileSchema, changePasswordSchema, changePasswordResultSchema,
  adminUserDetailSchema, adminUpdateUserSchema, adminUpdateUserResultSchema,
  switchAccountSchema, inviteUserSchema, acceptInviteSchema,
} from '@atlas/contracts';
import { AuthService } from './identity/auth.service.js';
import { UsersService } from './identity/users.service.js';
import { OrganizationsService } from './organizations/organizations.service.js';
import { IngestionService } from '@atlas/ingestion';
import { KpiService } from '@atlas/kpi';
import { DashboardsService } from './dashboards/dashboards.service.js';
import { WorkforceService } from './workforce/workforce.service.js';
import { WorkforceController } from './workforce/workforce.controller.js';
import { ConversationsService } from './ai/conversations.service.js';
import { ConversationsController } from './ai/conversations.controller.js';
import { AppError, SafeExceptionFilter } from './common/errors.js';


const cookieName = () => process.env.NODE_ENV === 'production' ? '__Host-atlas_session' : 'atlas_session';
function cookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' }; }
function token(request: Request): string {
  const cookies: unknown = request.cookies;
  if (!cookies || typeof cookies !== 'object') return '';
  const value: unknown = (cookies as Record<string, unknown>)[cookieName()];
  return typeof value === 'string' ? value : '';
}
function setSession(response: Response, result: { token: string; ttl: number }) { response.cookie(cookieName(), result.token, { ...cookieOptions(), maxAge: result.ttl * 1000 }); }

@Controller()
class FoundationController {
  @Get('health') health() { return healthSchema.parse({ service: 'atlas-api', status: 'ok', version: '0.1.0', timestamp: new Date().toISOString() }); }
  @Get('features') features() { return { ...foundationFeatures, authentication: true, ingestion: true, semanticModel: true, dashboards: true, workforce: true, aiChat: true }; }
}
@Controller('semantic')
class SemanticController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(KpiService) private readonly service: KpiService) {}
  @Get('relationships') async list(@Req() request: Request) {
    return this.service.listRelationships(await this.auth.authenticate(token(request)));
  }
  @Post('relationships') async create(@Req() request: Request, @Body() body: unknown, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) {
    return this.service.createRelationship(await this.auth.authenticate(token(request)), body, key, String(response.locals.correlationId));
  }
}
@Controller('auth')
class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}
  @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const input = loginSchema.parse(body);
    const result = await this.auth.login(input.email, input.password, request.ip ?? 'unknown');
    setSession(response, result); return loginResultSchema.parse({ stage: result.stage });
  }
  @Get('mfa/setup') async setup(@Req() request: Request) { return mfaSetupSchema.parse(await this.auth.setup(token(request))); }
  @Post('mfa/verify') @HttpCode(200)
  async verify(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const input = totpSchema.parse(body); const result = await this.auth.verifyMfa(token(request), input.code);
    setSession(response, result); return loginResultSchema.parse({ stage: result.stage });
  }
  @Get('session') async session(@Req() request: Request) {
    const principal = await this.auth.authenticate(token(request));
    const [organization, self] = await Promise.all([
      this.organizations.name(principal),
      this.users.getSelf(principal),
    ]);
    return sessionSchema.parse({
      ...principal,
      organization,
      name: self.name,
      email: self.email,
    });
  }
  @Post('switch-account') @HttpCode(200)
  async switchAccount(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const input = switchAccountSchema.parse(body);
    const result = await this.auth.switchAccount(token(request), input.accountId);
    setSession(response, result);
    const principal = await this.auth.authenticate(result.token);
    const [organization, self] = await Promise.all([
      this.organizations.name(principal),
      this.users.getSelf(principal),
    ]);
    return sessionSchema.parse({
      ...principal,
      organization,
      name: self.name,
      email: self.email,
    });
  }
  @Post('clear-account') @HttpCode(200)
  async clearAccount(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.clearActiveAccount(token(request));
    setSession(response, result);
    const principal = await this.auth.authenticate(result.token);
    const [organization, self] = await Promise.all([
      this.organizations.name(principal),
      this.users.getSelf(principal),
    ]);
    return sessionSchema.parse({
      ...principal,
      organization,
      name: self.name,
      email: self.email,
    });
  }
  @Post('logout') @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(token(request)); response.clearCookie(cookieName(), cookieOptions());
  }
  @Post('revoke-all') @HttpCode(204)
  async revokeAll(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.revokeAll(await this.auth.authenticate(token(request))); response.clearCookie(cookieName(), cookieOptions());
  }
}
@Controller('accounts')
class AccountsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(OrganizationsService) private readonly organizations: OrganizationsService) {}
  @Get() async list(@Req() request: Request) { return this.organizations.accounts(await this.auth.authenticate(token(request))); }
  @Get(':id') async get(@Req() request: Request, @Param('id') id: string) { return this.organizations.account(await this.auth.authenticate(token(request)), id); }
  @Post() async create(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown, @Headers('idempotency-key') key: string) {
    const principal = await this.auth.authenticate(token(request));
    const correlationId = String(response.locals.correlationId);
    return this.organizations.createAccount(principal, createAccountSchema.parse(body), key, correlationId);
  }
  @Patch(':id') async update(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown) {
    const principal = await this.auth.authenticate(token(request));
    return this.organizations.updateAccount(principal, id, updateAccountSchema.parse(body), String(response.locals.correlationId));
  }
  @Delete(':id') async delete(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    const principal = await this.auth.authenticate(token(request));
    return deleteAccountResultSchema.parse(await this.organizations.deleteAccount(principal, id, String(response.locals.correlationId)));
  }
  @Post(':id/unarchive') async unarchive(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    const principal = await this.auth.authenticate(token(request));
    return this.organizations.unarchiveAccount(principal, id, String(response.locals.correlationId));
  }
  @Get(':id/members') async getMembers(@Req() request: Request, @Param('id') id: string) {
    const principal = await this.auth.authenticate(token(request));
    return this.organizations.getAccountMembers(principal, id);
  }
  @Put(':id/members') async setMembers(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: { memberIds: string[] }) {
    const principal = await this.auth.authenticate(token(request));
    return this.organizations.setAccountMembers(principal, id, body.memberIds ?? [], String(response.locals.correlationId));
  }
}
@Controller('users')
class UsersController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
  ) {}
  @Get() async list(@Req() request: Request) {
    return this.users.list(await this.auth.authenticate(token(request)));
  }
  @Post() async create(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const principal = await this.auth.authenticate(token(request));
    return createUserResultSchema.parse(await this.users.createUser(principal, createUserSchema.parse(body), String(response.locals.correlationId)));
  }
  @Post('invite') async invite(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const principal = await this.auth.authenticate(token(request));
    return this.users.inviteUser(principal, inviteUserSchema.parse(body), String(response.locals.correlationId));
  }
  @Post('accept-invite') @HttpCode(200)
  async acceptInvite(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    return this.users.acceptInvite(acceptInviteSchema.parse(body), String(response.locals.correlationId));
  }
  @Get('me') async getProfile(@Req() request: Request) {
    const principal = await this.auth.authenticate(token(request));
    const org = await this.organizations.name(principal);
    return userProfileSchema.parse(await this.users.getProfile(principal, org));
  }
  @Patch('me') async updateProfile(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const principal = await this.auth.authenticate(token(request));
    const org = await this.organizations.name(principal);
    return userProfileSchema.parse(await this.users.updateProfile(principal, updateProfileSchema.parse(body), org, String(response.locals.correlationId)));
  }
  @Post('me/password') @HttpCode(200)
  async changePassword(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const principal = await this.auth.authenticate(token(request));
    return changePasswordResultSchema.parse(await this.users.changePassword(principal, changePasswordSchema.parse(body), String(response.locals.correlationId)));
  }
  @Get(':id') async getUserDetail(@Req() request: Request, @Param('id') id: string) {
    const principal = await this.auth.authenticate(token(request));
    return adminUserDetailSchema.parse(await this.users.getUserDetail(principal, id));
  }
  @Patch(':id') async adminUpdateUser(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown) {
    const principal = await this.auth.authenticate(token(request));
    return adminUpdateUserResultSchema.parse(await this.users.adminUpdateUser(principal, id, adminUpdateUserSchema.parse(body), String(response.locals.correlationId)));
  }
  @Patch(':id/role') async changeRole(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown) {
    const principal = await this.auth.authenticate(token(request));
    return updateRoleResultSchema.parse(await this.users.updateRole(principal, id, updateRoleSchema.parse(body).role, String(response.locals.correlationId)));
  }
  @Delete(':id') async removeMember(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    const principal = await this.auth.authenticate(token(request));
    return removeMemberResultSchema.parse(await this.users.removeMember(principal, id, String(response.locals.correlationId)));
  }
}
@Controller('datasets')
class DatasetsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(IngestionService) private readonly service: IngestionService) {}
  @Get('') async action0(@Req() request: Request) {
    const includeArchived = request.query.includeArchived === 'true';
    return this.service.list(await this.auth.authenticate(token(request)), includeArchived);
  }
  @Post('') async action1(@Req() request: Request, @Body() body: unknown, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) { return this.service.create(await this.auth.authenticate(token(request)),body,key,String(response.locals.correlationId)); }
  @Get(':id/versions') async action2(@Req() request: Request, @Param('id') id: string) { return this.service.versions(await this.auth.authenticate(token(request)),id); }
  @Post(':id/uploads') async action3(@Req() request: Request, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) { return this.service.upload(await this.auth.authenticate(token(request)),id,body,key,String(response.locals.correlationId)); }
  @Delete(':id') async delete(@Req() request: Request, @Param('id') id: string, @Res({passthrough:true}) response: Response) {
    return this.service.deleteOrArchive(await this.auth.authenticate(token(request)), id, String(response.locals.correlationId));
  }
  @Post(':id/unarchive') async unarchive(@Req() request: Request, @Param('id') id: string, @Res({passthrough:true}) response: Response) {
    return this.service.unarchive(await this.auth.authenticate(token(request)), id, String(response.locals.correlationId));
  }
  @Post(':id/ai-column/preview') async aiColumnPreview(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.previewAiColumn(await this.auth.authenticate(token(request)), id, body);
  }
  @Post(':id/ai-column') async aiColumnCreate(@Req() request: Request, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({passthrough:true}) response: Response) {
    const finalKey = key || (request.headers['idempotency-key'] as string) || crypto.randomUUID();
    return this.service.createAiColumnVersion(await this.auth.authenticate(token(request)), id, body, finalKey, String(response.locals.correlationId));
  }
}
@Controller('uploads')
class UploadsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(IngestionService) private readonly service: IngestionService) {}
  @Get(':id/issues') async issues(@Req() request: Request, @Param('id') id: string) { return this.service.issues(await this.auth.authenticate(token(request)), id); }
  @Get(':id') async action0(@Req() request: Request, @Param('id') id: string) { return this.service.get(await this.auth.authenticate(token(request)),id); }
  @Get(':id/preview') async action1(@Req() request: Request, @Param('id') id: string) { return this.service.preview(await this.auth.authenticate(token(request)),id); }
  @Post(':id/confirm') async action2(@Req() request: Request, @Param('id') id: string) { return this.service.confirm(await this.auth.authenticate(token(request)),id); }
  @Post(':id/retry-profile') async retryProfile(@Req() request: Request, @Param('id') id: string) { return this.service.retryProfile(await this.auth.authenticate(token(request)),id); }
  @Post(':id/mapping') async action3(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { return this.service.map(await this.auth.authenticate(token(request)),id,body); }
  @Post(':id/cancel') async action4(@Req() request: Request, @Param('id') id: string, @Res({passthrough:true}) response: Response) { return this.service.cancel(await this.auth.authenticate(token(request)),id,String(response.locals.correlationId)); }
  @Post(':id/publish') async action5(@Req() request: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) { return this.service.publish(await this.auth.authenticate(token(request)),id,key,String(response.locals.correlationId)); }
  @Post(':id/restore') async action6(@Req() request: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) { return this.service.publish(await this.auth.authenticate(token(request)),id,key,String(response.locals.correlationId),true); }
}
@Controller('kpis')
class KpisController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(KpiService) private readonly service: KpiService) {}
  @Get('') async action0(@Req() request: Request) {
    const includeDeprecated = request.query.includeDeprecated === 'true';
    return this.service.list(await this.auth.authenticate(token(request)), includeDeprecated);
  }
  @Post('') async action1(@Req() request: Request, @Body() body: unknown, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) { return this.service.create(await this.auth.authenticate(token(request)),body,key,String(response.locals.correlationId)); }
  @Post(':id/publish') async action2(@Req() request: Request, @Param('id') id: string, @Res({passthrough:true}) response: Response) { return this.service.publish(await this.auth.authenticate(token(request)),id,String(response.locals.correlationId)); }
  @Post(':id/deprecate') async deprecate(@Req() request: Request, @Param('id') id: string, @Res({passthrough:true}) response: Response) { return this.service.deprecate(await this.auth.authenticate(token(request)),id,String(response.locals.correlationId)); }
  @Delete(':id') async delete(@Req() request: Request, @Param('id') id: string, @Res({passthrough:true}) response: Response) {
    return this.service.deleteOrDeprecate(await this.auth.authenticate(token(request)), id, String(response.locals.correlationId));
  }
}
@Controller('queries')
class QueriesController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(KpiService) private readonly service: KpiService) {}
  @Post('') @HttpCode(200) async action0(@Req() request: Request, @Body() body: unknown, @Res({passthrough:true}) response: Response) { return this.service.query(await this.auth.authenticate(token(request)),body,String(response.locals.correlationId)); }
}
@Controller('dashboards')
class DashboardsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(DashboardsService) private readonly service: DashboardsService) {}
  @Get('') async list(@Req() request: Request) { return this.service.list(await this.auth.authenticate(token(request))); }
  @Get(':id') async get(@Req() request: Request, @Param('id') id: string) { return this.service.get(await this.auth.authenticate(token(request)), id); }
  @Get(':id/filter-options') async getFilterOptions(@Req() request: Request, @Param('id') id: string) {
    return this.service.getFilterOptions(await this.auth.authenticate(token(request)), id);
  }
  @Post('') async create(@Req() request: Request, @Body() body: unknown, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) {
    return this.service.create(await this.auth.authenticate(token(request)), body, key, String(response.locals.correlationId));
  }
  @Post(':id/versions') async saveVersion(@Req() request: Request, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) {
    return this.service.saveVersion(await this.auth.authenticate(token(request)), id, body, key, String(response.locals.correlationId));
  }
  @Post(':id/publish') async publish(@Req() request: Request, @Param('id') id: string, @Body('versionId') versionId: string, @Headers('idempotency-key') key: string, @Res({passthrough:true}) response: Response) {
    return this.service.publish(await this.auth.authenticate(token(request)), id, versionId, key, String(response.locals.correlationId));
  }
}
@Module({
  controllers: [FoundationController, SemanticController, AuthController, AccountsController, UsersController, DatasetsController, UploadsController, KpisController, QueriesController, DashboardsController, WorkforceController, ConversationsController],
  providers: [
    { provide: AuthService, useFactory: () => new AuthService() },
    { provide: OrganizationsService, useFactory: () => new OrganizationsService() },
    { provide: UsersService, useFactory: (auth: AuthService) => new UsersService(auth), inject: [AuthService] },
    { provide: IngestionService, useFactory: () => new IngestionService() },
    { provide: KpiService, useFactory: (data: IngestionService) => new KpiService(data), inject: [IngestionService] },
    { provide: DashboardsService, useFactory: () => new DashboardsService() },
    { provide: WorkforceService, useFactory: () => new WorkforceService() },
    {
      provide: ConversationsService,
      useFactory: (kpi: KpiService, ingestion: IngestionService, wf: WorkforceService, dash: DashboardsService) =>
        new ConversationsService(kpi, ingestion, wf, dash),
      inject: [KpiService, IngestionService, WorkforceService, DashboardsService],
    },
  ],
})
export class AppModule {}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  app.setGlobalPrefix('api/v1');
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000';
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('HTTPS_ORIGIN_REQUIRED');
  app.use(helmet());
  app.use((request: Request, response: Response, next: NextFunction) => {
    const correlationId = randomUUID(); const started = performance.now();
    response.locals.correlationId = correlationId;
    response.setHeader('X-Correlation-Id', correlationId); response.setHeader('Cache-Control', 'no-store');
    response.on('finish', () => console.log(JSON.stringify({ event: 'request.completed', method: request.method, status: response.statusCode, correlationId, durationMs: Math.round(performance.now() - started) })));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== origin) {
      response.status(403).json({ code: 'ORIGIN_REJECTED', message: 'Origen de solicitud no permitido.', correlationId }); return;
    }
    next();
  });
  app.use(json({ limit: '10mb', strict: true }));
  app.use(cookieParser());
  // Feature gates apply to incomplete/future capabilities outside current phase.
  app.use((request: Request, _response: Response, next: NextFunction) => {
    if (/^\/api\/v1\/(connectors|coaching|evaluations)(\/|$)/.test(request.path)) {
      next(new AppError('FEATURE_UNAVAILABLE', 503, 'Esta función todavía no está disponible.')); return;
    }
    next();
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
  await app.init(); return app;
}
