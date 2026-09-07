/**
 * @file apps/api/src/common/errors.ts
 * @description Filtro global de excepciones seguras (SafeExceptionFilter) para el API de ATLAS.
 * Intercepta DomainErrors, ZodErrors y HttpExceptions, normalizándolos en respuestas JSON auditables
 * con `correlationId` según `errorResponseSchema`. Protege la privacidad evitando registrar en logs
 * mensajes de excepción, payloads, encabezados o credenciales sensibles.
 */

import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { errorResponseSchema, DomainError } from '@atlas/contracts';

export class AppError extends DomainError {}

/**
 * Filtro de excepciones seguro que oculta detalles internos del servidor y retorna códigos de error tipados.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  /**
   * Captura cualquier excepción de la aplicación y genera una respuesta HTTP estructurada.
   *
   * @param error Error o excepción capturada.
   * @param host Argumentos de ejecución HTTP.
   */
  catch(error: unknown, host: ArgumentsHost) {

    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const correlationId = typeof response.locals.correlationId === 'string' ? response.locals.correlationId : randomUUID();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'No se pudo completar la operación. Inténtalo de nuevo.';
    if (error instanceof DomainError) { status = error.status; code = error.code; message = error.message; }
    else if (error instanceof ZodError) { status = 400; code = 'INVALID_INPUT'; message = 'Revisa los datos enviados.'; }
    else if (error instanceof HttpException) { status = error.getStatus(); code = status === 404 ? 'NOT_FOUND' : 'REQUEST_REJECTED'; message = status === 404 ? 'Recurso no encontrado.' : 'La solicitud no pudo procesarse.'; }
    else if (error && typeof error === 'object' && 'type' in error && ['entity.parse.failed', 'entity.too.large'].includes(String(error.type))) {
      status = error.type === 'entity.too.large' ? 413 : 400; code = 'INVALID_BODY'; message = 'El cuerpo de la solicitud no es válido o supera el límite permitido.';
    }
    // Never log exception messages, URLs, bodies, headers, emails or query parameters.
    if (status >= 500) console.error(JSON.stringify({ event: 'request.failed', method: request.method, status, code, correlationId }));
    response.status(status).json(errorResponseSchema.parse({ code, message, correlationId }));
  }
}
