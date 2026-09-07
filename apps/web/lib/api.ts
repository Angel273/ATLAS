/**
 * @file apps/web/lib/api.ts
 * @description Cliente HTTP tipado para el frontend Next.js de ATLAS (@atlas/web).
 * Realiza peticiones a `/api/v1`, valida las respuestas exitosas contra esquemas Zod
 * y extrae mensajes de error seguros y auditables (`correlationId`) en caso de fallo.
 */

import { errorResponseSchema } from '@atlas/contracts';
import type { z } from 'zod';

/**
 * Realiza una petición HTTP segura hacia los endpoints `/api/v1` del backend y valida el resultado con Zod.
 *
 * @param path Ruta relativa del endpoint (ej: `/semantic/kpis`).
 * @param schema Esquema Zod para validar la carga de respuesta.
 * @param init Opciones adicionales de RequestInit (método, cuerpo, cabeceras).
 * @returns Promesa con los datos parseados y tipados.
 */
export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {

  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const text = await response.text();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = null;
  }
  if (!response.ok) {
    const parsed = value ? errorResponseSchema.safeParse(value) : null;
    throw new Error(parsed?.success ? `${parsed.data.message} (Ref. ${parsed.data.correlationId.slice(0, 8)})` : 'El servicio no está disponible temporalmente. Inténtalo de nuevo.');
  }
  return schema.parse(value);
}
