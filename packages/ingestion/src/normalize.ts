/**
 * @file packages/ingestion/src/normalize.ts
 * @description Normalización determinista de celdas y valores para datasets en ATLAS.
 * Procesa conversiones estrictas respetando configuraciones regionales (separadores de miles/decimales,
 * formatos de fecha y zonas horarias mediante Temporal API), límites de precisión decimal (máx 38 dígitos),
 * validación de booleanos, duraciones no negativas y generación segura de identificadores de columna (`targetName`).
 */

import { Temporal } from '@js-temporal/polyfill';
import type { FieldType, Regional } from '@atlas/contracts';
export type Cell = string | number | boolean | Date | null | { error: string };
export type Value = string | boolean | null;
const fail = (code: string): never => { throw new Error(code); };

/**
 * Normaliza y valida una celda individual de acuerdo con su tipo de dato esperado y configuración regional.
 *
 * @param value Valor en bruto proveniente de CSV o Excel.
 * @param type Tipo de dato objetivo ('string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'duration').
 * @param regional Reglas de formato (separador decimal, de miles, formato de fecha, zona horaria).
 * @param required Si es true, lanza error si el valor es nulo o vacío.
 * @returns Cadena normalizada, booleano o null.
 * @throws Error con código semántico en caso de incoherencia de tipo o violación de formato.
 */
export function normalize(value: Cell, type: FieldType, regional: Regional, required: boolean): Value {

  if (value === null || value === '') { if (required) fail('REQUIRED_VALUE'); return null; }
  if (typeof value === 'object' && !(value instanceof Date)) return fail(value.error);
  if (type === 'string') return value instanceof Date ? value.toISOString() : String(value);
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['true', 'verdadero', '1'].includes(text)) return true;
    if (['false', 'falso', '0'].includes(text)) return false;
    return fail('INVALID_BOOLEAN');
  }
  if (['decimal', 'integer', 'duration'].includes(type)) {
    let text = String(value).trim();
    if (typeof value !== 'number') {
      const separator = regional.decimalSeparator;
      const parts = text.split(separator);
      if (parts.length > 2) return fail('INVALID_NUMBER');
      const whole = parts[0] ?? '';
      const thousands = regional.thousandsSeparator;
      if (thousands !== 'none' && whole.includes(thousands)) {
        const groups = whole.replace(/^[+-]/, '').split(thousands);
        if (!/^\d{1,3}$/.test(groups[0] ?? '') || groups.slice(1).some(group => !/^\d{3}$/.test(group))) return fail('INVALID_GROUPING');
      }
      text = (thousands === 'none' ? whole : whole.split(thousands).join('')) + (parts.length === 2 ? `.${parts[1]}` : '');
    }
    if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return fail('INVALID_NUMBER');
    const unsigned = text.replace(/^[+-]/, ''), [integer = '', fraction = ''] = unsigned.split('.');
    if (integer.replace(/^0+/, '').length + fraction.length > 38 || fraction.length > 12) return fail('DECIMAL_PRECISION_LIMIT');
    if (type === 'integer' && fraction.replace(/0/g, '')) return fail('INTEGER_REQUIRED');
    if (type === 'duration' && text.startsWith('-')) return fail('NEGATIVE_DURATION');
    const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
    const normalizedFraction = fraction.replace(/0+$/, '');
    return `${text.startsWith('-') && /[1-9]/.test(unsigned) ? '-' : ''}${normalizedInteger}${normalizedFraction ? `.${normalizedFraction}` : ''}`;
  }
  let text = value instanceof Date ? value.toISOString().replace(/Z$/, '') : String(value).trim();
  if (!(value instanceof Date) && regional.dateFormat !== 'YYYY-MM-DD') {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/.exec(text);
    if (!match) return fail('INVALID_DATE_FORMAT');
    text = `${match[3]}-${regional.dateFormat === 'DD/MM/YYYY' ? match[2] : match[1]}-${regional.dateFormat === 'DD/MM/YYYY' ? match[1] : match[2]}${match[4]}`;
  }
  try {
    if (type === 'date') {
      if (value instanceof Date) text = text.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fail('INVALID_DATE_FORMAT');
      return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString();
    }
    text = text.replace(' ', 'T');
    if (/Z$|[+-]\d{2}:\d{2}$/.test(text)) return Temporal.Instant.from(text).toString();
    const local = Temporal.PlainDateTime.from(text, { overflow: 'reject' });
    return local.toZonedDateTime(regional.timezone, { disambiguation: 'reject' }).toInstant().toString();
  } catch { return fail('INVALID_OR_AMBIGUOUS_DATE'); }
}
/**
 * Genera un identificador normalizado de columna SQL (snake_case) a partir del encabezado de la hoja de cálculo.
 * Remueve tildes, signos de puntuación y asegura que comience con una letra minúscula.
 *
 * @param header Texto original del encabezado del archivo.
 * @param index Índice de la columna (0-indexed) para desambiguación si no hay caracteres válidos.
 * @returns Nombre de campo compatible con identificadores SQL de PostgreSQL.
 */
export function targetName(header: string, index: number): string {
  const cleaned = header.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 52);
  return /^[a-z]/.test(cleaned) ? cleaned : `campo_${index + 1}${cleaned ? `_${cleaned}` : ''}`;
}

