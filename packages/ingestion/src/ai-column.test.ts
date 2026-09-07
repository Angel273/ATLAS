/**
 * @file packages/ingestion/src/ai-column.test.ts
 * @description Pruebas unitarias para el generador de valores en lote de Columnas Asistidas con IA.
 * Valida la inferencia estructurada, el mapeo de rowNumber a valores computados,
 * y el funcionamiento offline determinista para sentiment, category, integer y boolean.
 */

import { describe, it, expect } from 'vitest';
import { generateAiBatchValues } from './ai-column.js';

describe('generateAiBatchValues (offline & deterministic)', () => {
  it('returns an empty map when given empty items list', async () => {
    const result = await generateAiBatchValues({
      prompt: 'Determina el sentimiento del cliente: Positivo, Neutro o Negativo.',
      targetColumn: 'sentimiento',
      targetType: 'string',
      items: [],
    });
    expect(result.size).toBe(0);
  });

  it('generates deterministic sentiment values for call center text', async () => {
    const items = [
      {
        rowNumber: 1,
        data: {
          comentario: 'Excelente atención, el ejecutivo resolvió mi problema rápidamente.',
        },
      },
      {
        rowNumber: 2,
        data: {
          comentario: 'Pésimo servicio, estuve esperando 40 minutos y me colgaron la llamada.',
        },
      },
      {
        rowNumber: 3,
        data: {
          comentario: 'Llamé para consultar mi saldo actual de la cuenta.',
        },
      },
    ];

    const result = await generateAiBatchValues({
      prompt: 'Determina el sentimiento del cliente: Positivo, Neutro o Negativo.',
      targetColumn: 'sentimiento',
      targetType: 'string',
      items,
    });

    expect(result.size).toBe(3);
    expect(result.get(1)).toBe('Positivo');
    expect(result.get(2)).toBe('Negativo');
    expect(result.get(3)).toBe('Neutro');
  });

  it('generates deterministic boolean flags for dissatisfaction', async () => {
    const items = [
      {
        rowNumber: 10,
        data: {
          motivo: 'Queja formal por cobro no reconocido y maltrato',
        },
      },
      {
        rowNumber: 20,
        data: {
          motivo: 'Consulta de horario de sucursales bancarias',
        },
      },
    ];

    const result = await generateAiBatchValues({
      prompt: 'Responde true si el cliente expresó molestia, queja o reclamo, o false si fue una consulta normal.',
      targetColumn: 'es_insatisfecho',
      targetType: 'boolean',
      items,
    });

    expect(result.size).toBe(2);
    expect(result.get(10)).toBe(true);
    expect(result.get(20)).toBe(false);
  });

  it('generates integer urgency scores between 1 and 5', async () => {
    const items = [
      {
        rowNumber: 101,
        data: {
          descripcion: 'Urgente: bloqueo de tarjeta por fraude en curso y pérdida total',
        },
      },
      {
        rowNumber: 102,
        data: {
          descripcion: 'Información general sobre promociones vigentes',
        },
      },
    ];

    const result = await generateAiBatchValues({
      prompt: 'Evalúa la urgencia del caso del 1 al 5 como un número entero.',
      targetColumn: 'urgencia',
      targetType: 'integer',
      items,
    });

    expect(result.size).toBe(2);
    const score1 = result.get(101);
    const score2 = result.get(102);
    expect(typeof score1).toBe('number');
    expect(typeof score2).toBe('number');
    expect(Number.isInteger(score1)).toBe(true);
    expect(Number.isInteger(score2)).toBe(true);
    expect(score1).toBeGreaterThanOrEqual(1);
    expect(score1).toBeLessThanOrEqual(5);
    expect(score2).toBeGreaterThanOrEqual(1);
    expect(score2).toBeLessThanOrEqual(5);
  });

  it('handles null and empty input fields safely without throwing', async () => {
    const items = [
      {
        rowNumber: 5,
        data: {
          comentario: null,
          motivo: undefined,
        },
      },
    ];

    const result = await generateAiBatchValues({
      prompt: 'Determina el sentimiento.',
      targetColumn: 'sentimiento',
      targetType: 'string',
      items,
    });

    expect(result.size).toBe(1);
    expect(result.has(5)).toBe(true);
    expect(result.get(5)).toBeNull();
  });
});
