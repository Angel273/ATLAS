import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketVersioningCommand, GetBucketVersioningCommand, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

export class ObjectStorage {
  readonly bucket: string;
  readonly client: S3Client;
  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'atlas-originals';
    const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.MINIO_ROOT_USER;
    const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD;
    if (!accessKeyId || !secretAccessKey) throw new Error('STORAGE_CONFIGURATION_REQUIRED');
    this.client = new S3Client({ ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}), region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  }
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
  async uploadUrl(key: string, bytes: number) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentLength: bytes, ContentType: 'application/octet-stream' }), { expiresIn: 300 });
  }
  async head(key: string) { return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); }
  async delete(key: string) {
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); } catch {}
  }
  async read(key: string, versionId: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, VersionId: versionId }));
    if (!(response.Body instanceof Readable)) throw new Error('STORAGE_STREAM_UNAVAILABLE');
    return response.Body;
  }
  close() { this.client.destroy(); }
}
