/**
 * @file packages/ingestion/src/repository.ts
 * @description Servicio transaccional de ingesta y ciclo de vida de Datasets (@atlas/ingestion).
 * Controla el ciclo dual de datasets (borrado definitivo para borradores no publicados vs archivo lógico
 * respaldado por triggers de PostgreSQL `23514` para versiones publicadas), generación de URLs firmadas S3,
 * confirmación de uploads, mapeo semántico de campos, desduplicación por hash, previsualización, auditoría y publicación inmutable.
 */

import { z } from 'zod';
import { createPool, withTenant, withAccount, type Pool, type PoolClient } from '@atlas/database';
import { actorSchema, DomainError, datasetCreateSchema, datasetListSchema, datasetSchema, versionSchema, versionListSchema, uploadCreateSchema, uploadResultSchema, mappingSchema, dataPreviewSchema, issueReportSchema, type DataActor, type DatasetVersion } from '@atlas/contracts';
import { ObjectStorage } from './storage.js';
import { ImportQueue } from './queue.js';

/**
 * Valida que el actor autenticado posea la capacidad (permiso RBAC) requerida para la acción.
 *
 * @param actor Contexto del usuario con roles y capacidades.
 * @param capability Nombre de la capacidad a verificar (ej. `dataset.manage`, `dataset.read`).
 * @throws DomainError con código FORBIDDEN y status 403 si carece del permiso.
 */
export function permit(actor: DataActor, capability: string) {
  actorSchema.parse(actor);
  if (!actor.capabilities.includes(capability)) throw new DomainError('FORBIDDEN', 403, 'No tienes permiso para realizar esta acción.');
}

/**
 * Ejecuta una acción dentro del contexto de cuenta y tenant si `actor.accountId` está disponible,
 * o solo a nivel tenant en caso contrario.
 */
function execute<T>(pool: Pool, actor: DataActor, action: (client: PoolClient) => Promise<T>): Promise<T> {
  if (actor.accountId) {
    return withAccount(pool, actor.tenantId, actor.accountId, action);
  }
  return withTenant(pool, actor.tenantId, action);
}

export const versionSelect = `SELECT id,account_id AS "accountId",dataset_id AS "datasetId",number,filename,bytes::int,regional,state,sha256,profile,mapping,row_count::float8 AS rows,issues,issue_count AS "issueCount",error_code AS "errorCode",published_at::text AS "publishedAt",created_at::text AS "createdAt",progress FROM dataset_versions`;
const datasetSelect = `SELECT id,account_id AS "accountId",name,slug,current_version_id AS "currentVersionId",archived_at::text AS "archivedAt",created_at::text AS "createdAt" FROM datasets`;

/**
 * Busca y valida el registro de una versión de dataset por su ID.
 *
 * @param client Cliente transaccional de PostgreSQL con tenant_id establecido.
 * @param id UUID de la versión.
 * @returns Estructura validada de DatasetVersion.
 */
export async function findVersion(client: PoolClient, id: string): Promise<DatasetVersion> {
  z.uuid().parse(id); const result = await client.query(`${versionSelect} WHERE id=$1`, [id]);
  if (!result.rows[0]) throw new DomainError('VERSION_NOT_FOUND', 404, 'Versión no encontrada.');
  return versionSchema.parse(result.rows[0]);
}

/**
 * Registra un evento auditable append-only en la tabla `audit_events`.
 *
 * @param client Cliente PostgreSQL activo.
 * @param actor Usuario responsable de la acción.
 * @param event Nombre canónico del evento.
 * @param target ID del recurso afectado.
 * @param correlation ID de correlación de la solicitud HTTP o job.
 */
export async function audit(client: PoolClient, actor: DataActor, event: string, target: string, correlation: string) {
  await client.query('INSERT INTO audit_events(tenant_id,actor_id,event,target_id,correlation_id) VALUES ($1,$2,$3,$4,$5)', [actor.tenantId, actor.userId, event, target, correlation]);
}

/**
 * Servicio central para la ingesta, versionado y administración de datasets.
 */
export class IngestionService {
  readonly pool = createPool(process.env.DATABASE_URL);
  readonly storage = new ObjectStorage();
  readonly jobs = new ImportQueue();

  /**
   * Inicializa el bucket de almacenamiento S3.
   */
  async onModuleInit() { await this.storage.initialize(); }

  /**
   * Cierra ordenadamente conexiones de base de datos, colas Redis y cliente S3.
   */
  async onModuleDestroy() { await Promise.all([this.pool.end(), this.jobs.close()]); this.storage.close(); }

  async list(actor: DataActor, includeArchived = false) {
    permit(actor, 'dataset.read');
    const where = includeArchived ? '' : 'WHERE archived_at IS NULL';
    return execute(this.pool, actor, async client => datasetListSchema.parse({ items: (await client.query(`${datasetSelect} ${where} ORDER BY created_at DESC LIMIT 100`)).rows }));
  }

  async create(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'dataset.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para crear datasets.');
    const input = datasetCreateSchema.parse(body);
    z.uuid().parse(key);
    try {
      return await execute(this.pool, actor, async client => {
        const added = await client.query(
          'INSERT INTO datasets(tenant_id,account_id,name,slug,creation_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,creation_key) DO NOTHING RETURNING id',
          [actor.tenantId, actor.accountId, input.name, input.slug, key]
        );
        const result = datasetSchema.parse((await client.query(`${datasetSelect} WHERE creation_key=$1`, [key])).rows[0]);
        if (result.name !== input.name || result.slug !== input.slug) throw new DomainError('IDEMPOTENCY_CONFLICT', 409, 'Esta solicitud ya se utilizó con otros datos.');
        if (added.rowCount) await audit(client, actor, 'dataset.created', result.id, correlation);
        return result;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new DomainError('DATASET_SLUG_EXISTS', 409, 'Ya existe un dataset con ese identificador.');
      throw error;
    }
  }

  async versions(actor: DataActor, datasetId: string) {
    permit(actor, 'dataset.read');
    z.uuid().parse(datasetId);
    return execute(this.pool, actor, async client => {
      if (!(await client.query('SELECT 1 FROM datasets WHERE id=$1', [datasetId])).rowCount) throw new DomainError('DATASET_NOT_FOUND', 404, 'Dataset no encontrado.');
      return versionListSchema.parse({ items: (await client.query(`${versionSelect} WHERE dataset_id=$1 ORDER BY number DESC LIMIT 100`, [datasetId])).rows });
    });
  }

  async get(actor: DataActor, id: string) {
    permit(actor, 'dataset.read');
    return execute(this.pool, actor, client => findVersion(client, id));
  }

  async upload(actor: DataActor, datasetId: string, body: unknown, key: string, correlation: string) {
    permit(actor, 'dataset.manage');
    z.uuid().parse(datasetId);
    z.uuid().parse(key);
    const input = uploadCreateSchema.parse(body);
    const result = await execute(this.pool, actor, async client => {
      const dataset = await client.query<{ account_id: string; current_version_id: string | null; archived_at: string | null }>(
        'SELECT account_id, current_version_id, archived_at FROM datasets WHERE id=$1 FOR UPDATE',
        [datasetId]
      );
      if (!dataset.rows[0]) throw new DomainError('DATASET_NOT_FOUND', 404, 'Dataset no encontrado.');
      if (dataset.rows[0].archived_at) throw new DomainError('DATASET_ARCHIVED', 400, 'No se pueden cargar archivos en un dataset archivado.');
      const accountId = dataset.rows[0].account_id;

      const previous = await client.query<{ id: string; object_key: string; regional: unknown }>(
        'SELECT id,object_key,regional FROM dataset_versions WHERE dataset_id=$1 AND creation_key=$2',
        [datasetId, key]
      );
      if (previous.rows[0]) {
        const version = await findVersion(client, previous.rows[0].id);
        if (version.filename !== input.filename || version.bytes !== input.bytes || JSON.stringify(previous.rows[0].regional) !== JSON.stringify(input.regional)) {
          const old = previous.rows[0].regional as Record<string, unknown>;
          if (version.filename !== input.filename || version.bytes !== input.bytes || Object.entries(input.regional).some(([k, value]) => old[k] !== value)) {
            throw new DomainError('IDEMPOTENCY_CONFLICT', 409, 'Esta solicitud ya se utilizó con otros datos.');
          }
        }
        if (version.state !== 'uploaded') throw new DomainError('UPLOAD_ALREADY_CONFIRMED', 409, 'El archivo ya fue confirmado. Consulta su versión.');
        return { version, objectKey: previous.rows[0].object_key };
      }
      const id = crypto.randomUUID(), objectKey = `${actor.tenantId}/${datasetId}/${id}/original`;
      await client.query(`INSERT INTO dataset_versions(id,tenant_id,account_id,dataset_id,number,actor_id,filename,bytes,format,object_key,regional,base_version_id,creation_key)
        VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(number),0)+1 FROM dataset_versions WHERE dataset_id=$4),$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, actor.tenantId, accountId, datasetId, actor.userId, input.filename, input.bytes, input.format, objectKey, input.regional, dataset.rows[0].current_version_id, key]);
      await audit(client, actor, 'upload.created', id, correlation);
      return { version: await findVersion(client, id), objectKey };
    });
    return uploadResultSchema.parse({ version: result.version, uploadUrl: await this.storage.uploadUrl(result.objectKey, result.version.bytes) });
  }

  async confirm(actor: DataActor, id: string) {
    permit(actor, 'dataset.manage');
    z.uuid().parse(id);
    await execute(this.pool, actor, async client => {
      const result = await client.query<{ state: string; object_key: string; object_version: string | null; bytes: string }>(
        'SELECT state,object_key,object_version,bytes FROM dataset_versions WHERE id=$1 FOR UPDATE',
        [id]
      );
      const row = result.rows[0];
      if (!row) throw new DomainError('VERSION_NOT_FOUND', 404, 'Versión no encontrada.');
      if (row.state !== 'uploaded' && row.state !== 'profiling') throw new DomainError('INVALID_IMPORT_STATE', 409, 'La versión ya avanzó a otro paso.');
      if (!row.object_version) {
        let head;
        try { head = await this.storage.head(row.object_key); } catch { throw new DomainError('UPLOAD_NOT_FOUND', 409, 'Termina la carga del archivo antes de continuar.'); }
        if (head.ContentLength !== Number(row.bytes) || !head.VersionId || head.VersionId === 'null') throw new DomainError('UPLOAD_MISMATCH', 400, 'El archivo no coincide con la carga o no tiene versionado.');
        await client.query("UPDATE dataset_versions SET state='profiling',object_version=$2 WHERE id=$1", [id, head.VersionId]);
      }
    });
    await this.jobs.enqueue({ tenantId: actor.tenantId, actorId: actor.userId, versionId: id, action: 'profile' });
    return this.get(actor, id);
  }

  async retryProfile(actor: DataActor, id: string) {
    permit(actor, 'dataset.manage');
    z.uuid().parse(id);
    await execute(this.pool, actor, async client => {
      const result = await client.query<{ state: string; mapping: unknown }>('SELECT state,mapping FROM dataset_versions WHERE id=$1 FOR UPDATE', [id]);
      const row = result.rows[0];
      if (!row) throw new DomainError('VERSION_NOT_FOUND', 404, 'Versión no encontrada.');
      if (!['failed', 'cancelled', 'profiling'].includes(row.state) || row.mapping) throw new DomainError('INVALID_IMPORT_STATE', 409, 'Esta versión no puede reanalizarse.');
      await client.query("UPDATE dataset_versions SET state='profiling',error_code=NULL,progress=0 WHERE id=$1", [id]);
    });
    await this.jobs.enqueue({ tenantId: actor.tenantId, actorId: actor.userId, versionId: id, action: 'profile' });
    return this.get(actor, id);
  }

  async map(actor: DataActor, id: string, body: unknown) {
    permit(actor, 'dataset.manage');
    const mapping = mappingSchema.parse(body);
    await execute(this.pool, actor, async client => {
      await client.query('SELECT id FROM dataset_versions WHERE id=$1 FOR UPDATE', [z.uuid().parse(id)]);
      const version = await findVersion(client, id);
      if (!['awaiting_mapping', 'failed', 'validating'].includes(version.state) || version.publishedAt) throw new DomainError('INVALID_IMPORT_STATE', 409, 'Esta versión no admite cambios de mapeo.');
      if (version.state === 'validating') {
        if (JSON.stringify(mappingSchema.parse(version.mapping)) !== JSON.stringify(mapping)) throw new DomainError('IMPORT_RUNNING', 409, 'Espera a que finalice o cancela la importación.');
        return;
      }
      const sheet = version.profile?.sheets.find(sheet => sheet.name === mapping.sheet);
      if (!sheet || mapping.fields.some(field => !sheet.headers.includes(field.source))) throw new DomainError('INVALID_MAPPING', 400, 'El mapeo contiene hojas o columnas inexistentes.');
      await client.query("UPDATE dataset_versions SET mapping=$2,state='validating',error_code=NULL,progress=0 WHERE id=$1", [id, mapping]);
    });
    await this.jobs.enqueue({ tenantId: actor.tenantId, actorId: actor.userId, versionId: id, action: 'import' });
    return this.get(actor, id);
  }

  async cancel(actor: DataActor, id: string, correlation: string) {
    permit(actor, 'dataset.manage');
    z.uuid().parse(id);
    await execute(this.pool, actor, async client => {
      const changed = await client.query("UPDATE dataset_versions SET state='cancelled' WHERE id=$1 AND published_at IS NULL AND state <> 'cancelled' RETURNING id", [id]);
      if (changed.rowCount) await audit(client, actor, 'import.cancelled', id, correlation);
      else {
        const version = await findVersion(client, id);
        if (version.publishedAt) throw new DomainError('PUBLISHED_VERSION_IMMUTABLE', 409, 'Una versión publicada no se puede cancelar.');
      }
    });
    return this.get(actor, id);
  }

  async publish(actor: DataActor, id: string, key: string, correlation: string, restore = false) {
    permit(actor, 'dataset.manage');
    z.uuid().parse(id);
    z.uuid().parse(key);
    return execute(this.pool, actor, async client => {
      const version = await findVersion(client, id);
      const current = await client.query<{ current_version_id: string | null }>('SELECT current_version_id FROM datasets WHERE id=$1 FOR UPDATE', [version.datasetId]);
      const existing = await client.query<{ version_id: string }>('SELECT version_id FROM dataset_publications WHERE dataset_id=$1 AND creation_key=$2', [version.datasetId, key]);
      if (existing.rows[0]) {
        if (existing.rows[0].version_id !== id) throw new DomainError('IDEMPOTENCY_CONFLICT', 409, 'La publicación ya se utilizó con otra versión.');
        return version;
      }
      await client.query('SELECT id FROM dataset_versions WHERE id=$1 FOR UPDATE', [id]);
      const fresh = await findVersion(client, id);
      const isSkippedPolicy = fresh.mapping?.errorPolicy === 'skip';
      const hasBlockingIssues = fresh.issueCount > 0 && !isSkippedPolicy;
      if (fresh.state !== 'ready' || hasBlockingIssues || !fresh.mapping || !fresh.sha256 || (restore && !fresh.publishedAt)) throw new DomainError('VERSION_NOT_READY', 409, 'La versión debe estar validada y sin errores bloqueantes.');
      if (!restore && fresh.publishedAt && current.rows[0]?.current_version_id !== id) throw new DomainError('RESTORE_REQUIRED', 409, 'Usa restaurar para volver a una versión histórica.');
      const base = await client.query<{ base_version_id: string | null }>('SELECT base_version_id FROM dataset_versions WHERE id=$1', [id]);
      if (!restore && !fresh.publishedAt && base.rows[0]?.base_version_id !== current.rows[0]?.current_version_id) throw new DomainError('BASE_VERSION_CHANGED', 409, 'Otra versión se publicó durante esta carga. Inicia una carga sobre la versión vigente.');
      if (!fresh.publishedAt) await client.query('UPDATE dataset_versions SET published_at=now() WHERE id=$1', [id]);
      await client.query('UPDATE datasets SET current_version_id=$2 WHERE id=$1', [version.datasetId, id]);
      await client.query('INSERT INTO dataset_publications(tenant_id,dataset_id,version_id,actor_id,creation_key) VALUES ($1,$2,$3,$4,$5)', [actor.tenantId, version.datasetId, id, actor.userId, key]);
      await audit(client, actor, restore ? 'dataset.restored' : 'dataset.published', id, correlation);
      return findVersion(client, id);
    });
  }

  async preview(actor: DataActor, id: string) {
    permit(actor, 'dataset.read');
    return execute(this.pool, actor, async client => {
      const version = await findVersion(client, id);
      const rows = await client.query('SELECT values FROM dataset_rows WHERE version_id=$1 ORDER BY row_number LIMIT 50', [id]);
      return dataPreviewSchema.parse({ fields: version.mapping?.fields ?? [], rows: rows.rows.map(row => row.values) });
    });
  }

  async source(client: PoolClient, id: string) {
    const version = await findVersion(client, id);
    if (!version.publishedAt || !version.mapping || version.state !== 'ready') throw new DomainError('PUBLISHED_VERSION_REQUIRED', 409, 'Selecciona una versión publicada.');
    const dataset = datasetSchema.parse((await client.query(`${datasetSelect} WHERE id=$1`, [version.datasetId])).rows[0]);
    return { version, dataset, relation: '(SELECT values FROM dataset_rows WHERE version_id = $1::uuid)', parameters: [id] };
  }

  async issues(actor: DataActor, id: string) {
    permit(actor, 'dataset.read');
    return execute(this.pool, actor, async client => {
      const version = await findVersion(client, id);
      const rows = await client.query('SELECT source_row::float8 AS row,field,code FROM dataset_issues WHERE version_id=$1 ORDER BY ordinal LIMIT 11000', [id]);
      return issueReportSchema.parse({ items: rows.rows, complete: version.errorCode !== 'ISSUE_LIMIT' });
    });
  }

  async deleteOrArchive(actor: DataActor, datasetId: string, correlation: string) {
    permit(actor, 'dataset.manage');
    z.uuid().parse(datasetId);

    return execute(this.pool, actor, async client => {
      const datasetRow = (await client.query<{ id: string; archived_at: string | null }>('SELECT id, archived_at FROM datasets WHERE id=$1 FOR UPDATE', [datasetId])).rows[0];
      if (!datasetRow) throw new DomainError('DATASET_NOT_FOUND', 404, 'Dataset no encontrado.');

      // Check if dataset has published versions
      const published = (await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM dataset_versions WHERE dataset_id=$1 AND published_at IS NOT NULL',
        [datasetId]
      )).rows[0]?.count;
      const hasPublishedVersions = Number(published || '0') > 0;

      if (hasPublishedVersions) {
        // Soft delete / Archivar
        await client.query('UPDATE datasets SET archived_at = now() WHERE id = $1', [datasetId]);
        await audit(client, actor, 'dataset.archived', datasetId, correlation);
        return { action: 'archived' as const, id: datasetId };
      }

      // Hard delete for drafts / unpublished datasets
      // Check if any semantic relationships link to this dataset
      const rels = (await client.query(
        'SELECT id FROM semantic_relationships WHERE from_dataset_id = $1 OR to_dataset_id = $1 LIMIT 1',
        [datasetId]
      )).rows;
      if (rels.length > 0) {
        throw new DomainError('DATASET_IN_USE', 409, 'No se puede eliminar: el dataset tiene relaciones semánticas asociadas. Elimina las relaciones primero.');
      }

      // Check if any KPI versions reference versions of this dataset
      const kpis = (await client.query(
        'SELECT id FROM kpi_versions WHERE dataset_version_id IN (SELECT id FROM dataset_versions WHERE dataset_id = $1) LIMIT 1',
        [datasetId]
      )).rows;
      if (kpis.length > 0) {
        throw new DomainError('DATASET_IN_USE', 409, 'No se puede eliminar: existen KPIs vinculados a este dataset.');
      }

      // Gather object keys to delete from storage
      const objectKeys = (await client.query<{ object_key: string }>(
        'SELECT object_key FROM dataset_versions WHERE dataset_id = $1',
        [datasetId]
      )).rows.map(r => r.object_key);

      // Break circular FK constraint
      await client.query('UPDATE datasets SET current_version_id = NULL WHERE id = $1', [datasetId]);

      // Delete rows, publications and versions
      await client.query('DELETE FROM dataset_rows WHERE version_id IN (SELECT id FROM dataset_versions WHERE dataset_id = $1)', [datasetId]);
      await client.query('DELETE FROM dataset_publications WHERE dataset_id = $1', [datasetId]);
      await client.query('DELETE FROM dataset_versions WHERE dataset_id = $1', [datasetId]);
      await client.query('DELETE FROM datasets WHERE id = $1', [datasetId]);

      // Delete binary objects in storage with complete version/marker purge
      for (const key of objectKeys) {
        try {
          await this.storage.purge(key);
        } catch {}
      }

      await audit(client, actor, 'dataset.deleted', datasetId, correlation);
      return { action: 'deleted' as const, id: datasetId };
    });
  }

  async unarchive(actor: DataActor, datasetId: string, correlation: string) {
    permit(actor, 'dataset.manage');
    z.uuid().parse(datasetId);

    return execute(this.pool, actor, async client => {
      const datasetRow = (await client.query<{ id: string; archived_at: string | null }>('SELECT id, archived_at FROM datasets WHERE id=$1 FOR UPDATE', [datasetId])).rows[0];
      if (!datasetRow) throw new DomainError('DATASET_NOT_FOUND', 404, 'Dataset no encontrado.');
      if (!datasetRow.archived_at) return { action: 'unarchived' as const, id: datasetId };

      await client.query('UPDATE datasets SET archived_at = NULL WHERE id = $1', [datasetId]);
      await audit(client, actor, 'dataset.unarchived', datasetId, correlation);
      return { action: 'unarchived' as const, id: datasetId };
    });
  }
}

