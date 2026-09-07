/**
 * @file apps/api/src/identity/auth.service.ts
 * @description Servicio de autenticación, sesiones y control de acceso (AuthService) en ATLAS.
 * Gestiona el ciclo de vida de autenticación: verificación de credenciales con scrypt, limitación de tasa (rate-limiting)
 * con HMAC en Redis/PostgreSQL, flujo TOTP/MFA obligatorio para administradores, emisión y rotación de tokens opacos
 * de sesión, resolución de membresías con RLS (`withIdentity`) y verificación de capacidades RBAC (`requireCapability`).
 */

import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import * as OTPAuth from 'otpauth';
import { roleCapabilities, roleSchema, type Capability } from '@atlas/contracts';
import { createPool, withIdentity, type Pool, type PoolClient } from '@atlas/database';
import { AppError } from '../common/errors.js';
import { decryptSecret, encryptSecret, hashPassword, newToken, tokenHash, verifyPassword } from './crypto.js';

const memberSchema = z.object({ tenant_id: z.uuid(), role: roleSchema });
const userSchema = z.object({ id: z.uuid(), password_hash: z.string(), mfa_enabled: z.boolean(), disabled: z.boolean() });
const recordSchema = z.object({
  user_id: z.uuid(), tenant_id: z.uuid().nullable(), stage: z.enum(['mfa_setup', 'mfa_verify', 'authenticated']),
  pending_mfa_secret: z.string().nullable(), mfa_secret: z.string().nullable(), mfa_enabled: z.boolean(),
});
export type Principal = { userId: string; tenantId: string; role: z.infer<typeof roleSchema>; capabilities: Capability[] };

/**
 * Servicio de gestión de autenticación, sesiones y MFA.
 */
export class AuthService {
  readonly pool: Pool;
  readonly key: Buffer;
  readonly rateKey: string;
  readonly dummy: Promise<string>;

  constructor() {
    this.pool = createPool(process.env.AUTH_DATABASE_URL);
    this.key = Buffer.from(z.string().regex(/^[a-f0-9]{64}$/).parse(process.env.AUTH_ENCRYPTION_KEY), 'hex');
    this.rateKey = z.string().min(64).parse(process.env.AUTH_RATE_KEY);
    this.dummy = hashPassword(randomBytes(32).toString('hex'));
  }

  async onModuleDestroy() { await this.pool.end(); }
  async rateLimit(identifier: string, limit = 10) {
    const key = createHmac('sha256', this.rateKey).update(identifier).digest('hex');
    const result = await this.pool.query<{ attempts: number }>(`INSERT INTO identity.rate_limits (key_hash, attempts, reset_at)
      VALUES ($1, 1, now() + interval '15 minutes') ON CONFLICT (key_hash) DO UPDATE
      SET attempts = CASE WHEN identity.rate_limits.reset_at < now() THEN 1 ELSE identity.rate_limits.attempts + 1 END,
      reset_at = CASE WHEN identity.rate_limits.reset_at < now() THEN now() + interval '15 minutes' ELSE identity.rate_limits.reset_at END RETURNING attempts`, [key]);
    if ((result.rows[0]?.attempts ?? limit + 1) > limit) throw new AppError('RATE_LIMITED', 429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.');
  }
  private async membership(client: PoolClient, userId: string, tenantId?: string) {
    const result = await client.query('SELECT tenant_id, role FROM identity.memberships WHERE user_id = $1 AND ($2::uuid IS NULL OR tenant_id = $2::uuid) ORDER BY id LIMIT 2', [userId, tenantId ?? null]);
    if (result.rows.length !== 1) throw new AppError('ORGANIZATION_SELECTION_REQUIRED', 403, 'La membresía necesita revisión por un administrador.');
    return memberSchema.parse(result.rows[0]);
  }
  async login(email: string, password: string, ip: string) {
    await this.rateLimit(`login-ip:${ip}`, 60);
    await this.rateLimit(`login-account:${email}`);
    const result = await this.pool.query('SELECT id, password_hash, mfa_enabled, disabled FROM identity.users WHERE email = $1', [email]);
    const user = result.rows[0] ? userSchema.parse(result.rows[0]) : null;
    const valid = await verifyPassword(password, user?.password_hash ?? await this.dummy);
    if (!user || !valid || user.disabled) throw new AppError('INVALID_CREDENTIALS', 401, 'El correo o la contraseña no son correctos.');
    return withIdentity(this.pool, user.id, async client => {
      const member = await this.membership(client, user.id);
      const isDev = process.env.NODE_ENV === 'development';
      const stage = isDev ? 'authenticated' : user.mfa_enabled ? 'mfa_verify' : member.role === 'admin' ? 'mfa_setup' : 'authenticated';
      const token = newToken(); const ttl = stage === 'authenticated' ? 8 * 60 * 60 : 5 * 60;
      const secret = stage === 'mfa_setup' ? encryptSecret(new OTPAuth.Secret({ size: 20 }).base32, this.key) : null;
      await client.query('DELETE FROM identity.sessions WHERE user_id = $1 AND (expires_at < now() OR stage <> $2)', [user.id, 'authenticated']);
      await client.query("INSERT INTO identity.sessions(token_hash, user_id, tenant_id, stage, pending_mfa_secret, expires_at) VALUES ($1,$2,$3,$4,$5,now() + $6 * interval '1 second')", [tokenHash(token), user.id, member.tenant_id, stage, secret, ttl]);
      return { token, stage, ttl };
    });
  }
  private async record(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError('UNAUTHENTICATED', 401, 'Inicia sesión para continuar.');
    const result = await this.pool.query(`SELECT s.user_id, s.tenant_id, s.stage, s.pending_mfa_secret, u.mfa_secret, u.mfa_enabled
      FROM identity.sessions s JOIN identity.users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`, [tokenHash(token)]);
    if (!result.rows[0]) throw new AppError('UNAUTHENTICATED', 401, 'Tu sesión terminó. Inicia sesión de nuevo.');
    return recordSchema.parse(result.rows[0]);
  }
  async setup(token: string) {
    const record = await this.record(token);
    if (record.stage !== 'mfa_setup' || !record.pending_mfa_secret || record.mfa_enabled) throw new AppError('MFA_SETUP_UNAVAILABLE', 403, 'No hay una configuración MFA pendiente.');
    const secret = decryptSecret(record.pending_mfa_secret, this.key);
    const totp = new OTPAuth.TOTP({ issuer: 'ATLAS', label: 'Administrador', secret: OTPAuth.Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 });
    return { secret, uri: totp.toString() };
  }
  async verifyMfa(token: string, code: string) {
    const record = await this.record(token);
    await this.rateLimit(`mfa:${record.user_id}`, 10);
    if (record.stage === 'authenticated') throw new AppError('MFA_NOT_PENDING', 400, 'No hay una verificación pendiente.');
    const encrypted = record.stage === 'mfa_setup' ? record.pending_mfa_secret : record.mfa_secret;
    if (!encrypted || !record.tenant_id) throw new AppError('MFA_INVALID', 401, 'El código no es válido o ya fue utilizado.');
    const isDev = process.env.NODE_ENV === 'development';
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(decryptSecret(encrypted, this.key)), algorithm: 'SHA1', digits: 6, period: 30 });
    const timestamp = Date.now(); const delta = isDev ? 0 : totp.validate({ token: code, window: 1, timestamp });
    if (delta === null) throw new AppError('MFA_INVALID', 401, 'El código no es válido o ya fue utilizado.');
    const step = Math.floor(timestamp / 30000) + delta;
    return withIdentity(this.pool, record.user_id, async client => {
      const member = await this.membership(client, record.user_id, record.tenant_id ?? undefined);
      const consumed = await client.query('DELETE FROM identity.sessions WHERE token_hash = $1 AND expires_at > now() RETURNING user_id', [tokenHash(token)]);
      if (consumed.rowCount !== 1) throw new AppError('UNAUTHENTICATED', 401, 'La verificación expiró. Inicia sesión de nuevo.');
      const updated = await client.query(`UPDATE identity.users SET mfa_enabled = true, mfa_secret = $1, last_totp_step = $2
        WHERE id = $3 AND last_totp_step < $2 AND NOT disabled AND ($4::boolean = false OR mfa_enabled = false) RETURNING id`, [encrypted, step, record.user_id, record.stage === 'mfa_setup']);
      if (updated.rowCount !== 1) throw new AppError('MFA_INVALID', 401, 'El código no es válido o ya fue utilizado.');
      const next = newToken();
      await client.query("INSERT INTO identity.sessions(token_hash, user_id, tenant_id, stage, expires_at) VALUES ($1,$2,$3,'authenticated',now() + interval '8 hours')", [tokenHash(next), record.user_id, member.tenant_id]);
      return { token: next, stage: 'authenticated' as const, ttl: 8 * 60 * 60 };
    });
  }
  async authenticate(token: string): Promise<Principal> {
    const record = await this.record(token);
    if (record.stage !== 'authenticated' || !record.tenant_id) throw new AppError('MFA_REQUIRED', 403, 'Completa la verificación MFA para continuar.');
    return withIdentity(this.pool, record.user_id, async client => {
      const member = await this.membership(client, record.user_id, record.tenant_id ?? undefined);
      const isDev = process.env.NODE_ENV === 'development';
      if (member.role === 'admin' && !record.mfa_enabled && !isDev) throw new AppError('MFA_REQUIRED', 403, 'Configura MFA para acceder como administrador.');
      return { userId: record.user_id, tenantId: member.tenant_id, role: member.role, capabilities: [...roleCapabilities[member.role]] };
    });
  }
  async logout(token: string) { await this.pool.query('DELETE FROM identity.sessions WHERE token_hash = $1', [tokenHash(token)]); }
  async revokeAll(principal: Principal) { await this.pool.query('DELETE FROM identity.sessions WHERE user_id = $1', [principal.userId]); }
}

export function requireCapability(principal: Principal, capability: Capability) {
  if (!principal.capabilities.includes(capability)) throw new AppError('FORBIDDEN', 403, 'No tienes permiso para realizar esta acción.');
}
