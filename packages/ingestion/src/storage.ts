/**
 * @file packages/ingestion/src/storage.ts
 * @description Capa de almacenamiento de objetos compatible con AWS S3 / MinIO para ATLAS.
 * Gestiona el bucket de archivos originales (`atlas-originals`), habilita el versionado de objetos,
 * genera URLs pre-firmadas seguras para subidas directas desde el navegador (evitando sobrecargar la API)
 * y proporciona streams de lectura para validación en workers.
 */

import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketVersioningCommand, GetBucketVersioningCommand, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

/**
 * Cliente de almacenamiento S3/MinIO con soporte para URLs pre-firmadas y lectura en streaming.
 */
export class ObjectStorage {
  readonly bucket: string;
  readonly client: S3Client;

  /**
   * Inicializa el cliente S3 a partir de variables de entorno seguras.
   */
  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'atlas-originals';
    const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.MINIO_ROOT_USER;
    const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD;
    if (!accessKeyId || !secretAccessKey) throw new Error('STORAGE_CONFIGURATION_REQUIRED');
    this.client = new S3Client({ ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}), region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  }

  /**
   * Asegura que el bucket de almacenamiento exista y tenga versionamiento habilitado.
   */
  async initialize() {
    try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }
    catch (error) {
      if (!(error instanceof Error) || !['NotFound', 'NoSuchBucket'].includes(error.name)) throw error;
      try { await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })); }
      catch (error) { if (!(error instanceof Error) || error.name !== 'BucketAlreadyOwnedByYou') throw error; }
    }
    const current = await this.client.send(new GetBucketVersioningCommand({ Bucket: this.bucket }));
    if (current.Status !== 'Enabled') await this.client.send(new PutBucketVersioningCommand({ Bucket: this.bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  }

  /**
   * Genera una URL pre-firmada segura (vigente por 5 minutos) para subida directa de archivos mediante PUT.
   *
   * @param key Clave del objeto en S3 (ej. `{tenantId}/{versionId}`).
   * @param bytes Tamaño exacto esperado del archivo en bytes.
   * @returns URL temporal pre-firmada.
   */
  async uploadUrl(key: string, bytes: number) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentLength: bytes, ContentType: 'application/octet-stream' }), { expiresIn: 300 });
  }

  /**
   * Consulta los metadatos y cabeceras de un objeto en el bucket.
   *
   * @param key Clave del objeto en S3.
   */
  async head(key: string) { return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); }

  /**
   * Elimina un objeto de almacenamiento en S3/MinIO de forma segura (silenciosa ante fallos).
   *
   * @param key Clave del objeto en S3.
   */
  async delete(key: string) {
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); } catch {}
  }

  /**
   * Obtiene un stream legible (`Readable`) del objeto almacenado para procesamiento en el worker.
   *
   * @param key Clave del objeto en S3.
   * @param versionId Versión específica del objeto S3.
   */
  async read(key: string, versionId: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, VersionId: versionId }));
    if (!(response.Body instanceof Readable)) throw new Error('STORAGE_STREAM_UNAVAILABLE');
    return response.Body;
  }

  /**
   * Cierra y destruye el cliente S3 liberando sockets y conexiones activas.
   */
  close() { this.client.destroy(); }

}
