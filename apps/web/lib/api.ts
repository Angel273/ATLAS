import { errorResponseSchema } from '@atlas/contracts';
import type { z } from 'zod';
export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const value: unknown = await response.json();
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(value);
    throw new Error(parsed.success ? `${parsed.data.message} (Ref. ${parsed.data.correlationId.slice(0, 8)})` : 'El servicio no está disponible. Inténtalo de nuevo.');
  }
  return schema.parse(value);
}
