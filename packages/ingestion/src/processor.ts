import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { createPool, withTenant, withIdentity } from '@atlas/database';
import { mappingSchema, profileSchema, regionalSchema, MAX_UPLOAD_BYTES, type Mapping, type FieldType } from '@atlas/contracts';
import { ObjectStorage } from './storage.js';
import { normalize, targetName, type Cell, type Value } from './normalize.js';
import { readRows } from './readers.js';
import { verifyTask, type ImportTask } from './queue.js';

const internalSchema = z.object({ object_key: z.string(), object_version: z.string(), bytes: z.coerce.number(), format: z.enum(['csv','xlsx']), regional: regionalSchema, sha256: z.string().nullable(), mapping: mappingSchema.nullable(), base_version_id: z.uuid().nullable(), state: z.string(), published_at: z.date().nullable() });
const terminal = ['ready', 'cancelled'];
export function sanitizeHeaders(cells: Cell[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((cell, index) => {
    let base = (cell !== null && cell !== undefined && typeof cell !== 'object' ? String(cell).trim() : '') || `Columna_${index + 1}`;
    if (base.length > 200) base = base.slice(0, 200);
    const key = base.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count > 0 ? `${base}_${count + 1}` : base;
  });
}

export async function processImport(input: unknown) {
  const task = verifyTask(input), pool = createPool(process.env.DATABASE_URL), auth = createPool(process.env.AUTH_DATABASE_URL), storage = new ObjectStorage();
  let directory: string | undefined;
  const authorize = async () => {
    const valid = await withIdentity(auth, task.actorId, client => client.query(`SELECT 1 FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.role='admin' AND NOT u.disabled AND u.mfa_enabled`, [task.actorId, task.tenantId]));
    if (!valid.rowCount) throw new Error('JOB_PERMISSION_REVOKED');
  };
  try {
    await authorize();
    const record = await withTenant(pool, task.tenantId, async client => {
      const result = await client.query('SELECT object_key,object_version,bytes,format,regional,sha256,mapping,base_version_id,state,published_at FROM dataset_versions WHERE id=$1', [task.versionId]);
      return internalSchema.parse(result.rows[0]);
    });
    if (record.published_at || terminal.includes(record.state) || (task.action === 'profile' && record.state === 'awaiting_mapping')) return;
    if (task.action === 'profile') {
      if (!['profiling', 'failed'].includes(record.state) || record.mapping) return;
      const changed = await withTenant(pool, task.tenantId, client => client.query("UPDATE dataset_versions SET state='profiling',error_code=NULL WHERE id=$1 AND state IN ('profiling','failed') AND mapping IS NULL RETURNING id", [task.versionId]));
      if (!changed.rowCount) return;
    }
    const regional = record.mapping?.regional ?? record.regional;
    directory = await mkdtemp(join(tmpdir(), 'atlas-import-')); const path = join(directory, 'original');
    const digest = createHash('sha256'); let size = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length; if (size > record.bytes || size > MAX_UPLOAD_BYTES) { callback(new Error('FILE_SIZE_MISMATCH')); return; }
      digest.update(chunk); callback(null, chunk);
    } });
    await pipeline(await storage.read(record.object_key, record.object_version), meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    if (size !== record.bytes) throw new Error('FILE_SIZE_MISMATCH');
    const sha256 = digest.digest('hex');
    if (record.sha256 && record.sha256 !== sha256) throw new Error('SOURCE_HASH_MISMATCH');
    if (task.action === 'profile') {
      const sheets = new Map<string, { name: string; headers: string[]; sample: (string | null)[][]; rows: number; cells: Cell[][] }>();
      let total = 0;
      for await (const row of readRows(path, record.format, regional)) {
        let sheet = sheets.get(row.sheet);
        if (!sheet) {
          const headers = sanitizeHeaders(row.cells);
          if (!headers.length) throw new Error('INVALID_OR_DUPLICATE_HEADERS');
          sheet = { name: row.sheet, headers, sample: [], rows: 0, cells: [] }; sheets.set(row.sheet, sheet); continue;
        }
        if (++total > 20_000_000) throw new Error('ROW_LIMIT');
        sheet.rows++;
        if (row.cells.length > sheet.headers.length) throw new Error('COLUMN_COUNT_MISMATCH');
        if (sheet.sample.length < 5) { sheet.cells.push(row.cells); sheet.sample.push(sheet.headers.map((_, i) => row.cells[i] === null || row.cells[i] === undefined ? null : typeof row.cells[i] === 'object' && !(row.cells[i] instanceof Date) ? '[valor no disponible]' : String(row.cells[i]))); }
        if (total % 10000 === 0) { await authorize(); await withTenant(pool, task.tenantId, async client => { const changed = await client.query("UPDATE dataset_versions SET progress=10 WHERE id=$1 AND state='profiling' RETURNING id", [task.versionId]); if (!changed.rowCount) throw new Error('IMPORT_CANCELLED'); }); }
      }
      if (!sheets.size) throw new Error('EMPTY_FILE');
      const profile = profileSchema.parse({ sheets: [...sheets.values()].map(sheet => {
        const names = new Set<string>();
        return { name: sheet.name, headers: sheet.headers, sample: sheet.sample, rows: sheet.rows, suggested: sheet.headers.map((header, index) => {
          let target = targetName(header, index); if (names.has(target)) target = `${target}_${index + 1}`; names.add(target);
          let type: FieldType = 'string';
          const values = sheet.cells.map(row => row[index] ?? null).filter(value => value !== null && value !== '');
          for (const candidate of ['integer', 'decimal', 'date', 'datetime', 'boolean'] as const) {
            try { if (!values.length) break; for (const value of values) normalize(value, candidate, regional, false); type = candidate; break; } catch { /* The suggestion remains conservative. */ }
          }
          return { source: header, target, type, required: false };
        }) };
      }) });
      await withTenant(pool, task.tenantId, client => client.query("UPDATE dataset_versions SET sha256=$2,profile=$3,state='awaiting_mapping',progress=100,error_code=NULL WHERE id=$1 AND state='profiling'", [task.versionId, sha256, profile]));
      return;
    }
    const mapping = mappingSchema.parse(record.mapping);
    let baseMax = 0;
    await withTenant(pool, task.tenantId, async client => {
      const current = await client.query<{ state: string }>('SELECT state FROM dataset_versions WHERE id=$1 FOR UPDATE', [task.versionId]);
      if (terminal.includes(current.rows[0]?.state ?? '')) throw new Error('IMPORT_CANCELLED');
      if (mapping.strategy !== 'replace') {
        if (!record.base_version_id) throw new Error('BASE_VERSION_REQUIRED');
        const base = await client.query<{ mapping: unknown }>('SELECT mapping FROM dataset_versions WHERE id=$1 AND published_at IS NOT NULL', [record.base_version_id]);
        const old = mappingSchema.parse(base.rows[0]?.mapping);
        const signature = (value: Mapping) => JSON.stringify({ fields: value.fields.map(field => ({ target: field.target, type: field.type, required: field.required })).sort((a,b) => a.target.localeCompare(b.target)), keys: value.keyFields });
        if (signature(old) !== signature(mapping)) throw new Error('INCOMPATIBLE_BASE_SCHEMA');
        baseMax = Number((await client.query('SELECT COALESCE(MAX(row_number),0) AS max FROM dataset_rows WHERE version_id=$1', [record.base_version_id])).rows[0]?.max ?? 0);
      }
      await client.query('DELETE FROM dataset_rows WHERE version_id=$1', [task.versionId]);
      await client.query('DELETE FROM dataset_issues WHERE version_id=$1', [task.versionId]);
      await client.query("UPDATE dataset_versions SET state='importing',row_count=0,issues='[]',issue_count=0,progress=0,error_code=NULL WHERE id=$1", [task.versionId]);
    });
    let headers: string[] | undefined, count = 0, issueCount = 0, accepted = 0;
    let batch: { number: number; values: Record<string, Value>; key: string | null; source: number }[] = [];
    let issues: { row: number; field: string; code: string }[] = [];
    const samples: typeof issues = [];
    const flush = async () => {
      await authorize();
      await withTenant(pool, task.tenantId, async client => {
        const state = await client.query<{ state: string }>('SELECT state FROM dataset_versions WHERE id=$1 FOR UPDATE', [task.versionId]);
        if (state.rows[0]?.state !== 'importing') throw new Error('IMPORT_CANCELLED');
        for (const row of batch) {
          const inserted = await client.query(`INSERT INTO dataset_rows(tenant_id,version_id,row_number,values,key_hash,source_version_id,source_row,source_sheet)
            VALUES ($1,$2,$3,$4,$5,$2,$6,$7) ON CONFLICT(tenant_id,version_id,key_hash) DO NOTHING RETURNING row_number`, [task.tenantId, task.versionId, row.number, row.values, row.key, row.source, mapping.sheet]);
          if (!inserted.rowCount) issues.push({ row: row.source, field: mapping.keyFields.join(','), code: 'DUPLICATE_KEY' }); else accepted++;
        }
        for (const issue of issues) {
          await client.query('INSERT INTO dataset_issues(tenant_id,version_id,ordinal,source_row,field,code) VALUES ($1,$2,$3,$4,$5,$6)', [task.tenantId, task.versionId, ++issueCount, issue.row, issue.field.slice(0, 200), issue.code]);
          if (samples.length < 100) samples.push(issue);
        }
        await client.query('UPDATE dataset_versions SET row_count=$2,issue_count=$3,issues=$4,progress=50 WHERE id=$1', [task.versionId, accepted, issueCount, JSON.stringify(samples)]);
      }); batch = []; issues = [];
    };
    for await (const row of readRows(path, record.format, regional)) {
      if (row.sheet !== mapping.sheet) continue;
      if (!headers) { headers = sanitizeHeaders(row.cells); if (mapping.fields.some(field => !headers?.includes(field.source))) throw new Error('SOURCE_HEADERS_CHANGED'); continue; }
      if (++count > 20_000_000) throw new Error('ROW_LIMIT');
      const values: Record<string, Value> = Object.create(null) as Record<string, Value>;
      let valid = true;
      for (const field of mapping.fields) {
        const isMandatory = field.required || mapping.keyFields.includes(field.target);
        try {
          values[field.target] = normalize(row.cells[headers.indexOf(field.source)] ?? null, field.type, regional, isMandatory);
        } catch (error) {
          const errCode = error instanceof Error ? error.message : 'INVALID_VALUE';
          if (mapping.errorPolicy === 'nullify' && !isMandatory) {
            values[field.target] = null;
          } else {
            valid = false;
            issues.push({ row: row.row, field: field.source, code: errCode });
          }
        }
      }
      if (valid) batch.push({ number: baseMax + count, values, key: mapping.keyFields.length ? createHash('sha256').update(JSON.stringify(mapping.keyFields.map(key => values[key]))).digest('hex') : null, source: row.row });
      if (batch.length + issues.length >= 500) await flush();
      if (issueCount > 10000) throw new Error('ISSUE_LIMIT');
    }
    await flush();
    if (!headers) throw new Error('SHEET_NOT_FOUND');
    await withTenant(pool, task.tenantId, async client => {
      const state = await client.query<{ state: string }>('SELECT state FROM dataset_versions WHERE id=$1 FOR UPDATE', [task.versionId]);
      if (state.rows[0]?.state !== 'importing') throw new Error('IMPORT_CANCELLED');
      if (issueCount && mapping.errorPolicy !== 'skip') {
        await client.query("UPDATE dataset_versions SET state='failed',error_code='VALIDATION_FAILED',progress=100 WHERE id=$1", [task.versionId]);
        return;
      }
      if (mapping.errorPolicy === 'skip' && !accepted) {
        await client.query("UPDATE dataset_versions SET state='failed',error_code='ALL_ROWS_REJECTED',progress=100 WHERE id=$1", [task.versionId]);
        return;
      }
      if (mapping.strategy !== 'replace' && record.base_version_id) {
        await client.query("SET LOCAL statement_timeout='120s'");
        await client.query(`INSERT INTO dataset_rows(tenant_id,version_id,row_number,values,key_hash,source_version_id,source_row,source_sheet)
          SELECT tenant_id,$1,row_number,values,key_hash,source_version_id,source_row,source_sheet FROM dataset_rows WHERE version_id=$2
          ${mapping.strategy === 'upsert' ? 'ON CONFLICT(tenant_id,version_id,key_hash) DO NOTHING' : ''}`, [task.versionId, record.base_version_id]);
      }
      await client.query("UPDATE dataset_versions SET state='ready',progress=100,row_count=(SELECT count(*) FROM dataset_rows WHERE version_id=$1) WHERE id=$1", [task.versionId]);
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'IMPORT_FAILED';
    const safe = /^[A-Z_]{3,80}$/.test(raw) ? raw : 'IMPORT_FAILED';
    await withTenant(pool, task.tenantId, client => client.query("UPDATE dataset_versions SET state='failed',error_code=$2 WHERE id=$1 AND state NOT IN ('cancelled','ready') AND published_at IS NULL", [task.versionId, safe]));
    if (safe === 'IMPORT_CANCELLED') return;
    throw new Error(safe);
  } finally {
    if (directory && resolve(directory).startsWith(resolve(tmpdir()) + '\\atlas-import-')) await rm(directory, { recursive: true, force: true });
    else if (directory && resolve(directory).startsWith(resolve(tmpdir()) + '/atlas-import-')) await rm(directory, { recursive: true, force: true });
    storage.close(); await Promise.all([pool.end(), auth.end()]);
  }
}
export async function failImport(task: ImportTask, code: string) {
  const pool = createPool(process.env.DATABASE_URL);
  try { await withTenant(pool, task.tenantId, client => client.query("UPDATE dataset_versions SET state='failed',error_code=$2 WHERE id=$1 AND state NOT IN ('cancelled','ready') AND published_at IS NULL", [task.versionId, code])); }
  finally { await pool.end(); }
}
