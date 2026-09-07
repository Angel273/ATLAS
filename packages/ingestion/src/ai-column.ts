/**
 * @file packages/ingestion/src/ai-column.ts
 * @description Módulo de enriquecimiento de datasets mediante Inteligencia Artificial por lotes (@atlas/ingestion).
 * Procesa colecciones de filas enviando lotes compactos (100 a 150 filas) hacia Google Gemini con modo JSON
 * estructurado (`responseMimeType: 'application/json'`), o mediante un motor analítico determinista local
 * para pruebas unitarias, CI/CD y entornos de desarrollo sin clave externa.
 */

export interface GenerateAiBatchParams {
  prompt: string;
  targetColumn: string;
  targetType: 'string' | 'integer' | 'decimal' | 'boolean';
  items: Array<{
    rowNumber: number;
    data: Record<string, unknown>;
  }>;
}

/**
 * Normaliza un valor arbitrario al tipo de dato destino estricto.
 */
function castToTargetType(
  raw: unknown,
  targetType: 'string' | 'integer' | 'decimal' | 'boolean'
): string | number | boolean | null {
  if (raw === null || raw === undefined || raw === '') return null;

  switch (targetType) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const str = String(raw).trim().toLowerCase();
      if (['true', '1', 'si', 'sí', 'yes', 'verdadero', 'positivo'].includes(str)) return true;
      if (['false', '0', 'no', 'falso', 'negativo'].includes(str)) return false;
      return false;
    }
    case 'integer': {
      const num = typeof raw === 'number' ? Math.round(raw) : parseInt(String(raw).replace(/[^0-9-]/g, ''), 10);
      return Number.isNaN(num) ? null : num;
    }
    case 'decimal': {
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
      return Number.isNaN(num) ? null : num;
    }
    case 'string':
    default:
      return String(raw).trim();
  }
}

/**
 * Motor determinista offline para previsualizaciones rápidas, tests y desarrollo sin API Key.
 */
export function mockEvaluateRow(
  data: Record<string, unknown>,
  prompt: string,
  targetType: 'string' | 'integer' | 'decimal' | 'boolean'
): string | number | boolean | null {
  const p = prompt.toLowerCase();
  const valuesText = Object.values(data)
    .filter(v => v !== null && v !== undefined)
    .map(v => String(v).toLowerCase())
    .join(' ');

  if (targetType === 'boolean') {
    if (p.includes('queja') || p.includes('reclamo')) {
      return /queja|reclamo|molesto|falla|error|mal|terrible|inconforme/.test(valuesText);
    }
    if (p.includes('resuelt') || p.includes('satisf')) {
      return /excelente|gracias|bueno|resuelto|solucionado|amable/.test(valuesText);
    }
    return /si|sí|true|yes|1|positivo|cumple|aprobado/.test(valuesText);
  }

  if (targetType === 'integer' || targetType === 'decimal') {
    if (p.includes('urgencia') || p.includes('prioridad') || p.includes('severidad')) {
      if (/urgente|inmediato|grave|demanda|crítico|critico|fraude/.test(valuesText)) return 5;
      if (/queja|falla|error|molesto|reiterado/.test(valuesText)) return 4;
      if (/duda|pregunta|informacion|consulta/.test(valuesText)) return 2;
      return 3;
    }
    if (p.includes('score') || p.includes('calificaci') || p.includes('nps') || p.includes('csat')) {
      if (/excelente|perfecto|maravilloso|felicito/.test(valuesText)) return 10;
      if (/bueno|gracias|rapido|satisfecho/.test(valuesText)) return 8;
      if (/regular|demora|espera/.test(valuesText)) return 5;
      if (/pesimo|pésimo|terrible|incompetente|estafa/.test(valuesText)) return 1;
      return 7;
    }
    return Math.max(1, (valuesText.length % 10) + 1);
  }

  // targetType === 'string'
  if (p.includes('sentimiento') || p.includes('sentiment')) {
    if (/excelente|bueno|gracias|rapido|rápido|amable|satisfecho|felicito|perfecto|muy bien/.test(valuesText)) {
      return 'Positivo';
    }
    if (/terrible|malo|pesimo|pésimo|tarde|queja|molesto|error|nunca|enojo|estafa|incompetente|falla/.test(valuesText)) {
      return 'Negativo';
    }
    return 'Neutro';
  }

  if (p.includes('categor') || p.includes('tema') || p.includes('motivo') || p.includes('departamento')) {
    if (/factur|cobro|pago|tarifa|precio|cuenta|cargo|saldo|dinero/.test(valuesText)) {
      return 'Facturación';
    }
    if (/tecnic|técnico|soporte|sistema|falla|error|conexion|conexión|caido|caído|lento/.test(valuesText)) {
      return 'Soporte Técnico';
    }
    if (/venta|comprar|promocion|promoción|plan|oferta|adquirir|contrat/.test(valuesText)) {
      return 'Ventas';
    }
    if (/queja|reclamo|demora|pesimo|pésimo|gerente|supervisor|denuncia/.test(valuesText)) {
      return 'Reclamos y Quejas';
    }
    return 'Consulta General';
  }

  if (p.includes('resumen') || p.includes('sintesis') || p.includes('síntesis')) {
    const clean = valuesText.slice(0, 60).trim();
    return clean.length > 0 ? `Caso: ${clean}...` : 'Sin comentarios registrados';
  }

  return valuesText.length > 0 ? valuesText.slice(0, 30).trim() : 'N/A';
}

/**
 * Invoca la API REST de Google Gemini para procesar un lote estructurado de filas.
 */
async function callGeminiBatch(
  params: GenerateAiBatchParams,
  apiKey: string,
  model: string
): Promise<Map<number, string | number | boolean | null>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const promptText = `Eres un transformador analítico de datos operacionales de call center.
Se te proporciona un lote de filas en formato JSON con su número de fila y los campos de contexto disponibles.
Debes aplicar rigurosamente la siguiente regla para calcular la columna requerida:

NOMBRE DE COLUMNA DESTINO: "${params.targetColumn}"
TIPO DE DATO ESPERADO: "${params.targetType}"
INSTRUCCIÓN: "${params.prompt}"

DATOS DEL LOTE DE ENTRADA:
${JSON.stringify(params.items)}

REGLAS OBLIGATORIAS:
1. Retorna ÚNICAMENTE un arreglo JSON con el resultado exacto para cada fila del lote.
2. Cada elemento del arreglo DEBE tener la estructura: { "rowNumber": <numero_de_fila>, "value": <valor_calculado> }
3. El valor calculado DEBE coincidir con el tipo "${params.targetType}" (o null si la fila carece de datos suficientes).
4. No omitas ningún "rowNumber" de la lista de entrada.
5. No agregues explicaciones, markdown ni texto fuera del bloque JSON.`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`GEMINI_API_ERROR: HTTP ${res.status} - ${errorText.slice(0, 200)}`);
  }

  const payload: any = await res.json();
  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('EMPTY_GEMINI_RESPONSE');

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Si viene envuelto en markdown ```json
    const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  const itemsList: Array<{ rowNumber: number; value: unknown }> = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed?.results)
    ? parsed.results
    : [];

  const resultMap = new Map<number, string | number | boolean | null>();
  for (const item of itemsList) {
    if (typeof item.rowNumber === 'number') {
      resultMap.set(item.rowNumber, castToTargetType(item.value, params.targetType));
    }
  }

  // Para cualquier fila que el modelo haya omitido, completar con el mock determinista
  for (const item of params.items) {
    if (!resultMap.has(item.rowNumber)) {
      resultMap.set(item.rowNumber, mockEvaluateRow(item.data, params.prompt, params.targetType));
    }
  }

  return resultMap;
}

/**
 * Determina si un objeto de datos de fila contiene al menos un campo con información útil.
 * Ignora valores nulos, undefined, cadenas vacías o valores 'null'.
 */
export function hasMeaningfulData(data: Record<string, unknown>): boolean {
  for (const val of Object.values(data)) {
    if (val !== null && val !== undefined) {
      const str = String(val).trim();
      if (str !== '' && str !== 'null' && str !== 'undefined') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Genera valores calculados por Inteligencia Artificial para un lote de filas.
 * Soporta Google Gemini y cuenta con fallback transparente al motor local determinista.
 * Filtra automáticamente las filas vacías para no desperdiciar tokens ni invocar la IA en celdas inexistentes.
 */
export async function generateAiBatchValues(
  params: GenerateAiBatchParams
): Promise<Map<number, string | number | boolean | null>> {
  const resultMap = new Map<number, string | number | boolean | null>();

  // 1. Filtrar filas vacías para no enviarlas a la IA ni desperdiciar tokens/costes
  const validItems: Array<{ rowNumber: number; data: Record<string, unknown> }> = [];

  for (const item of params.items) {
    if (!hasMeaningfulData(item.data)) {
      resultMap.set(item.rowNumber, null);
    } else {
      // Limpiar datos: solo enviar campos con contenido real sin celdas vacías
      const cleanedData: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(item.data)) {
        if (val !== null && val !== undefined) {
          const str = String(val).trim();
          if (str !== '' && str !== 'null' && str !== 'undefined') {
            cleanedData[key] = typeof val === 'string' ? str : val;
          }
        }
      }
      validItems.push({
        rowNumber: item.rowNumber,
        data: cleanedData,
      });
    }
  }

  // Si todas las filas del lote carecen de datos, retornar inmediatamente sin llamar a la IA
  if (validItems.length === 0) {
    return resultMap;
  }

  const validParams: GenerateAiBatchParams = {
    ...params,
    items: validItems,
  };

  const forceMock = process.env.AI_PROVIDER?.toLowerCase().trim() === 'mock';
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

  if (!forceMock && apiKey && apiKey.length > 0) {
    try {
      const aiMap = await callGeminiBatch(validParams, apiKey, model);
      for (const [rowNum, val] of aiMap.entries()) {
        resultMap.set(rowNum, val);
      }
      return resultMap;
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'ai_column.gemini_fallback',
          error: error instanceof Error ? error.message : String(error),
          rowCount: validItems.length,
        })
      );
      // Fallback elegante al evaluador determinista
    }
  }

  // Motor determinista local para las filas con datos válidos
  for (const item of validItems) {
    const computed = mockEvaluateRow(item.data, params.prompt, params.targetType);
    resultMap.set(item.rowNumber, computed);
  }
  return resultMap;
}

