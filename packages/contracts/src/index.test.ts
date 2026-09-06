import { describe, expect, it } from 'vitest';
import { datasetMappingSchema, loginSchema, totpSchema, errorResponseSchema, sessionSchema, roleCapabilities, roleSchema, employeeCreateSchema, teamCreateSchema, querySchema, widgetDefinitionSchema, createUserSchema, updateProfileSchema, changePasswordSchema, memberSchema } from './index.js';
describe('Trust boundaries', () => {
  it('applies the user-approved role matrix and reserves mutations for Admin', () => {
    for (const role of roleSchema.options.filter(role => role !== 'admin')) {
      expect(roleCapabilities[role].some(capability => capability.endsWith('.manage') || capability.endsWith('.publish'))).toBe(false);
    }
    expect(roleCapabilities.operations_manager).toContain('workforce.read');
    expect(roleCapabilities.ceo).not.toContain('workforce.read');
    expect(roleCapabilities.operations_manager).not.toContain('dataset.read');
    expect(roleCapabilities.supervisor).toContain('dataset.read');
    expect(roleCapabilities.admin).toContain('user.manage');
  });
  it('rejects a tenant injected into login', () => {
    expect(loginSchema.safeParse({ email: 'synthetic@example.invalid', password: 'irrelevant', tenant_id: 'other' }).success).toBe(false);
  });
  it('validates MFA shape and prevents oversized input', () => {
    expect(totpSchema.safeParse({ code: '123456' }).success).toBe(true);
    for (const code of ['12345', '1234567', 'abcdef', '<script>']) expect(totpSchema.safeParse({ code }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'synthetic@example.invalid', password: 'a'.repeat(129) }).success).toBe(false);
  });
  it('rejects unsafe mappings, duplicate targets and nonexistent upsert keys', () => {
    const field = { source: 'Calls', target: 'calls', type: 'integer', required: true };
    expect(datasetMappingSchema.safeParse({ strategy: 'replace', fields: [field], keyFields: [] }).success).toBe(true);
    expect(datasetMappingSchema.safeParse({ strategy: 'upsert', fields: [field], keyFields: [] }).success).toBe(false);
    expect(datasetMappingSchema.safeParse({ strategy: 'upsert', fields: [field], keyFields: ['missing'] }).success).toBe(false);
    expect(datasetMappingSchema.safeParse({ strategy: 'replace', fields: [field, field], keyFields: [] }).success).toBe(false);
    expect(datasetMappingSchema.safeParse({ strategy: 'replace', fields: [{ ...field, target: 'drop;table' }], keyFields: [] }).success).toBe(false);
  });
  it('rejects extra data in public errors and invalid capabilities', () => {
    expect(errorResponseSchema.safeParse({ code: 'FAIL', message: 'Safe', correlationId: 'invalid', stack: 'private' }).success).toBe(false);
    expect(sessionSchema.safeParse({ capabilities: ['sql.execute'] }).success).toBe(false);
  });
  it('validates workforce schemas and rejects invalid slugs or empty codes', () => {
    expect(employeeCreateSchema.safeParse({ code: 'AGT-01', firstName: 'Juan', lastName: 'Perez' }).success).toBe(true);
    expect(employeeCreateSchema.safeParse({ code: '', firstName: 'Juan', lastName: 'Perez' }).success).toBe(false);
    expect(teamCreateSchema.safeParse({ name: 'Soporte', slug: 'soporte_n1' }).success).toBe(true);
    expect(teamCreateSchema.safeParse({ name: 'Soporte', slug: 'INVALID SLUG!' }).success).toBe(false);
  });
  it('validates querySchema timeRange flexibility and widgetDefinition dateField', () => {
    const kpiId = 'a0000000-0000-4000-8000-000000000001';
    const parsedQuery = querySchema.safeParse({
      kpiVersionId: kpiId,
      timeRange: { from: '2026-01-01', to: '2026-01-31' },
    });
    expect(parsedQuery.success).toBe(true);
    if (parsedQuery.success) {
      expect(parsedQuery.data.timeRange?.field).toBe('');
    }

    const parsedWidget = widgetDefinitionSchema.safeParse({
      id: 'a0000000-0000-4000-8000-000000000002',
      title: 'AHT Semanal',
      type: 'kpi_card',
      grid: { x: 0, y: 0, w: 6, h: 4 },
      dateField: 'call_date',
    });
    expect(parsedWidget.success).toBe(true);
    if (parsedWidget.success) {
      expect(parsedWidget.data.dateField).toBe('call_date');
    }
  });
  it('validates user creation, profile update and password change schemas', () => {
    expect(createUserSchema.safeParse({ email: 'NEW.User@example.com', name: 'Ana Morales', role: 'supervisor', password: 'Valid-Password-14!' }).success).toBe(true);
    // Short password (< 14 chars)
    expect(createUserSchema.safeParse({ email: 'user@example.com', role: 'supervisor', password: 'short' }).success).toBe(false);
    // Invalid role
    expect(createUserSchema.safeParse({ email: 'user@example.com', role: 'superadmin', password: 'Valid-Password-14!' }).success).toBe(false);
    // Profile update with empty payload rejected
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: 'Nuevo Nombre' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ email: 'nuevo@example.com' }).success).toBe(true);
    // Password change
    expect(changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'New-Strong-Password-14!' }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'too-short' }).success).toBe(false);
    // Member schema defaults name to empty string if omitted
    const parsedMember = memberSchema.safeParse({ id: 'a0000000-0000-4000-8000-000000000001', userId: 'a0000000-0000-4000-8000-000000000002', email: 'a***@example.com', role: 'admin' });
    expect(parsedMember.success).toBe(true);
    if (parsedMember.success) expect(parsedMember.data.name).toBe('');
  });
});
