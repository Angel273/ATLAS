/**
 * @file page.tsx
 * @description Módulo integral de gestión de Datasets, ingesta de archivos CSV/XLSX y ciclo de vida dual.
 * Proporciona subida directa firmada a S3/MinIO, perfilado streaming, mapeo de columnas y tipos,
 * validación regional, reporte de errores en celdas, publicación inmutable, borrado definitivo (drafts)
 * y archivado lógico con protección por triggers.
 */

'use client';
import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { z } from 'zod';
import {
  sessionSchema,
  datasetListSchema,
  datasetSchema,
  datasetLifecycleResultSchema,
  versionListSchema,
  versionSchema,
  uploadResultSchema,
  dataPreviewSchema,
  fieldTypeSchema,
  issueReportSchema,
  errorPolicySchema,
  aiColumnPreviewResultSchema,
  aiColumnCreateResultSchema,
  type Session,
  type DatasetVersion,
  type Regional,
  type Mapping,
  type FieldType,
  type ErrorPolicy,
  type AiColumnPreviewResult,
} from '@atlas/contracts';
import { api } from '../../../lib/api';
import { Brand } from '../../../components/workspace';
import { AppHeader } from '../../../components/app-header';

const initialRegional: Regional = {
  decimalSeparator: '.',
  thousandsSeparator: 'none',
  dateFormat: 'DD/MM/YYYY',
  timezone: 'America/Guatemala',
  delimiter: ',',
};

const states: Record<DatasetVersion['state'], string> = {
  uploaded: 'Archivo pendiente de análisis',
  profiling: 'Analizando archivo...',
  awaiting_mapping: 'Configurar columnas y mapeo',
  validating: 'En cola de validación',
  importing: 'Validando filas...',
  ready: 'Validado y listo para publicar',
  failed: 'Requiere corrección',
  cancelled: 'Carga cancelada',
};

const errorTranslations: Record<string, string> = {
  INVALID_OR_DUPLICATE_HEADERS: 'El archivo contenía encabezados vacíos o duplicados. Usa "Reanalizar archivo" para procesarlo con saneamiento automático.',
  VALIDATION_FAILED: 'Se detectaron errores en los datos (tipos incompatibles, formatos de fecha o claves duplicadas). Revisa el reporte detallado abajo.',
  IMPORT_FAILED: 'Ocurrió un error al procesar el archivo. Revisa el formato y vuelve a intentar.',
  IMPORT_CANCELLED: 'La importación fue cancelada por el usuario.',
  ROW_LIMIT: 'El archivo supera el límite de 20 millones de filas.',
  COLUMN_LIMIT: 'El archivo supera el límite de 200 columnas.',
  SOURCE_HEADERS_CHANGED: 'Las columnas del archivo cambiaron respecto a la configuración guardada.',
  INCOMPATIBLE_BASE_SCHEMA: 'El esquema no coincide con la versión base para la estrategia append/upsert.',
  BASE_VERSION_REQUIRED: 'La estrategia append/upsert requiere una versión base publicada previamente.',
  INVALID_CSV_RECORD: 'El archivo CSV tiene delimitadores incorrectos o registros mal formados.',
  INVALID_XLSX: 'El archivo Excel no es válido o está dañado.',
  ACTIVE_WORKBOOK_CONTENT: 'El libro de Excel contiene macros o vínculos externos no permitidos.',
  ISSUE_LIMIT: 'Se superó el límite máximo de 10,000 errores de datos.',
  INVALID_NUMBER: 'El valor no es un número válido según la configuración regional.',
  INVALID_GROUPING: 'El separador de miles no respeta grupos de 3 dígitos.',
  INVALID_DATE_FORMAT: 'La fecha no coincide con el formato regional seleccionado.',
  INVALID_OR_AMBIGUOUS_DATE: 'La fecha es ambigua o imposible para la zona horaria.',
  REQUIRED_VALUE: 'Este campo está marcado como obligatorio pero la celda está vacía.',
  DUPLICATE_KEY: 'Se encontró una clave primaria duplicada en esta fila.',
  INVALID_BOOLEAN: 'Valor booleano no válido (esperado: verdadero/falso, true/false, 1/0).',
  EMPTY_FILE: 'El archivo no contiene filas o datos legibles.',
  UNSUPPORTED_CELL_VALUE: 'Celda con error de fórmula de Excel (#N/A, #¡VALOR!, etc.) o valor no convertible.',
  EXCEL_ERROR_NA: 'Celda con error de Excel #N/A (la fórmula de búsqueda o VLOOKUP no encontró coincidencia en la hoja).',
  EXCEL_ERROR_VALUE: 'Celda con error de Excel #¡VALOR! (tipos incompatibles en la fórmula).',
  EXCEL_ERROR_REF: 'Celda con error de Excel #¡REF! (referencia no válida o celda eliminada).',
  EXCEL_ERROR_DIV0: 'Celda con error de Excel #¡DIV/0! (división entre cero).',
  EXCEL_ERROR_NAME: 'Celda con error de Excel #¿NOMBRE? (fórmula o función no reconocida).',
  FORMULA_WITHOUT_CACHED_VALUE: 'Fórmula de Excel sin valor calculado previo guardado en el archivo.',
};

/**
 * Traduce un código de error técnico de validación o ingesta a un mensaje legible para el usuario.
 */
function humanizeError(code: string | null): string {
  if (!code) return '';
  return errorTranslations[code] ?? `Código de error: ${code}`;
}

interface ColumnConfig {
  source: string;
  target: string;
  type: FieldType;
  required: boolean;
  isKey: boolean;
  included: boolean;
  sample: string | null;
}

interface AiTemplate {
  id: string;
  name: string;
  icon: string;
  targetColumn: string;
  targetType: 'string' | 'integer' | 'decimal' | 'boolean';
  prompt: string;
  description: string;
}

const AI_TEMPLATES: AiTemplate[] = [
  {
    id: 'sentiment',
    name: 'Sentimiento',
    icon: '💬',
    targetColumn: 'sentimiento_cliente',
    targetType: 'string',
    prompt: 'Determina el sentimiento del cliente: Positivo, Neutro o Negativo.',
    description: 'Clasifica el tono del contacto.',
  },
  {
    id: 'category',
    name: 'Categoría / Motivo',
    icon: '🏷️',
    targetColumn: 'categoria_contacto',
    targetType: 'string',
    prompt: 'Clasifica el motivo de contacto o consulta en una frase concisa (máximo 4 palabras).',
    description: 'Agrupa llamadas por temática.',
  },
  {
    id: 'urgency',
    name: 'Nivel de Urgencia',
    icon: '⚡',
    targetColumn: 'nivel_urgencia',
    targetType: 'integer',
    prompt: 'Evalúa la urgencia o severidad del caso del 1 (baja) al 5 (crítica) como un número entero.',
    description: 'Puntaje numérico del 1 al 5.',
  },
  {
    id: 'dissatisfaction',
    name: 'Cliente Insatisfecho',
    icon: '⚠️',
    targetColumn: 'cliente_insatisfecho',
    targetType: 'boolean',
    prompt: 'Responde true si el cliente expresó insatisfacción o reclamo grave, o false en caso de interacción cordial o resuelta.',
    description: 'Bandera booleana (true/false).',
  },
];

function extractColumnsFromVersion(v: DatasetVersion | null): string[] {
  if (!v) return [];
  if (v.mapping?.fields && v.mapping.fields.length > 0) {
    return v.mapping.fields.map(f => f.target);
  }
  const sheet = v.profile?.sheets?.[0];
  if (sheet?.suggested && sheet.suggested.length > 0) {
    return sheet.suggested.map(s => s.target);
  }
  if (sheet?.headers && sheet.headers.length > 0) {
    return sheet.headers;
  }
  return [];
}

/**
 * Componente principal de la interfaz de Datasets y gestión de ciclo de vida de versiones.
 */
export default function DatasetsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [datasets, setDatasets] = useState<z.infer<typeof datasetSchema>[]>([]);
  const [selected, setSelected] = useState('');
  const [showCreateDataset, setShowCreateDataset] = useState(false);

  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [version, setVersion] = useState<DatasetVersion | null>(null);
  const [issues, setIssues] = useState<{ row: number; field: string; code: string }[]>([]);
  const [regional, setRegional] = useState<Regional>(initialRegional);

  // Column mapping states
  const [selectedSheet, setSelectedSheet] = useState('');
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [strategy, setStrategy] = useState<Mapping['strategy']>('replace');
  const [errorPolicy, setErrorPolicy] = useState<ErrorPolicy>('strict');
  const [columnSearch, setColumnSearch] = useState('');
  const [issueSearch, setIssueSearch] = useState('');

  const [preview, setPreview] = useState<z.infer<typeof dataPreviewSchema> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const [showArchived, setShowArchived] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // AI Column Modal states
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiBaseVersionId, setAiBaseVersionId] = useState('');
  const [aiTargetColumn, setAiTargetColumn] = useState('sentimiento_cliente');
  const [aiTargetType, setAiTargetType] = useState<'string' | 'integer' | 'decimal' | 'boolean'>('string');
  const [aiPrompt, setAiPrompt] = useState('Determina el sentimiento del cliente: Positivo, Neutro o Negativo.');
  const [aiSourceCols, setAiSourceCols] = useState<string[]>([]);
  const [aiBatchSize, setAiBatchSize] = useState<number>(100);
  const [aiPreviewBusy, setAiPreviewBusy] = useState(false);
  const [aiPreviewError, setAiPreviewError] = useState('');
  const [aiPreviewResult, setAiPreviewResult] = useState<AiColumnPreviewResult | null>(null);
  const [aiCreateBusy, setAiCreateBusy] = useState(false);

  const manage = session?.capabilities.includes('dataset.manage');
  const activeDataset = useMemo(() => datasets.find(d => d.id === selected) ?? null, [datasets, selected]);

  const hasPublishedVersions = useMemo(() => {
    return Boolean(activeDataset?.currentVersionId || versions.some(v => Boolean(v.publishedAt)));
  }, [activeDataset, versions]);

  const eligibleVersions = useMemo(() => {
    return versions.filter(v => Boolean(v.publishedAt) || v.state === 'ready');
  }, [versions]);

  const selectedBaseVersion = useMemo(() => {
    return versions.find(v => v.id === aiBaseVersionId)
      ?? (version && (version.publishedAt || version.state === 'ready') ? version : null)
      ?? eligibleVersions[0]
      ?? null;
  }, [versions, aiBaseVersionId, version, eligibleVersions]);

  const availableAiSourceColumns = useMemo(() => {
    return extractColumnsFromVersion(selectedBaseVersion);
  }, [selectedBaseVersion]);

  function openAiModal(targetVer?: DatasetVersion) {
    const base = targetVer
      ?? (version && (version.publishedAt || version.state === 'ready') ? version : null)
      ?? eligibleVersions[0]
      ?? null;
    if (!base) {
      setError('Se requiere al menos una versión validada o publicada para generar una columna con IA.');
      return;
    }
    setAiBaseVersionId(base.id);
    const cols = extractColumnsFromVersion(base);
    setAiSourceCols(cols.length > 0 ? cols.slice(0, Math.min(3, cols.length)) : []);
    setAiTargetColumn('sentimiento_cliente');
    setAiTargetType('string');
    setAiPrompt('Determina el sentimiento del cliente: Positivo, Neutro o Negativo.');
    setAiBatchSize(100);
    setAiPreviewResult(null);
    setAiPreviewError('');
    setShowAiModal(true);
  }

  function applyAiTemplate(tpl: AiTemplate) {
    setAiTargetColumn(tpl.targetColumn);
    setAiTargetType(tpl.targetType);
    setAiPrompt(tpl.prompt);
    setAiPreviewResult(null);
    setAiPreviewError('');
  }

  function toggleAiSourceCol(col: string) {
    setAiSourceCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
    setAiPreviewResult(null);
  }

  async function handleAiPreview() {
    if (!activeDataset) return;
    if (!aiTargetColumn.trim() || !/^[a-z][a-z0-9_]*$/.test(aiTargetColumn.trim())) {
      setAiPreviewError('El nombre de la columna debe empezar con letra minúscula y contener solo letras minúsculas, números o guiones bajos.');
      return;
    }
    if (aiPrompt.trim().length < 5) {
      setAiPreviewError('El prompt para la IA debe tener al menos 5 caracteres.');
      return;
    }
    if (aiSourceCols.length === 0) {
      setAiPreviewError('Debes seleccionar al menos una columna de contexto para la IA.');
      return;
    }

    setAiPreviewBusy(true);
    setAiPreviewError('');
    try {
      const res = await api(`/datasets/${activeDataset.id}/ai-column/preview`, aiColumnPreviewResultSchema, {
        method: 'POST',
        body: JSON.stringify({
          baseVersionId: aiBaseVersionId || undefined,
          targetColumn: aiTargetColumn.trim(),
          targetType: aiTargetType,
          prompt: aiPrompt.trim(),
          sourceColumns: aiSourceCols,
        }),
      });
      setAiPreviewResult(res);
    } catch (e) {
      setAiPreviewError(e instanceof Error ? e.message : 'Error al previsualizar la columna con IA.');
    } finally {
      setAiPreviewBusy(false);
    }
  }

  async function handleAiGenerate() {
    if (!activeDataset) return;
    if (!aiTargetColumn.trim() || !/^[a-z][a-z0-9_]*$/.test(aiTargetColumn.trim())) {
      setAiPreviewError('El nombre de la columna debe empezar con letra minúscula y contener solo letras minúsculas, números o guiones bajos.');
      return;
    }
    if (aiPrompt.trim().length < 5) {
      setAiPreviewError('El prompt para la IA debe tener al menos 5 caracteres.');
      return;
    }
    if (aiSourceCols.length === 0) {
      setAiPreviewError('Debes seleccionar al menos una columna de contexto para la IA.');
      return;
    }

    setAiCreateBusy(true);
    setError('');
    try {
      const res = await api(`/datasets/${activeDataset.id}/ai-column`, aiColumnCreateResultSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          baseVersionId: aiBaseVersionId || undefined,
          targetColumn: aiTargetColumn.trim(),
          targetType: aiTargetType,
          prompt: aiPrompt.trim(),
          sourceColumns: aiSourceCols,
          batchSize: aiBatchSize,
        }),
      });
      setShowAiModal(false);
      setNotice(`Generando versión v${res.version.number} con columna IA '${aiTargetColumn.trim()}'. El worker está enriqueciendo los registros en segundo plano.`);
      await refresh();
      const freshVersions = await api(`/datasets/${activeDataset.id}/versions`, versionListSchema);
      setVersions(freshVersions.items);
      const created = freshVersions.items.find(v => v.id === res.version.id);
      if (created) {
        setVersion(created);
      }
    } catch (e) {
      setAiPreviewError(e instanceof Error ? e.message : 'Error al solicitar generación de columna con IA.');
    } finally {
      setAiCreateBusy(false);
    }
  }

  async function refresh(includeArch = showArchived) {
    const result = await api(`/datasets?includeArchived=${includeArch}`, datasetListSchema);
    setDatasets(result.items);
  }

  async function handleDeleteOrArchive() {
    if (!activeDataset) return;
    await run(async () => {
      const res = await api(`/datasets/${activeDataset.id}`, datasetLifecycleResultSchema, {
        method: 'DELETE',
      });
      if (res.action === 'deleted') {
        setNotice(`El dataset '${activeDataset.name}' ha sido eliminado definitivamente.`);
        setSelected('');
        setVersion(null);
        setVersions([]);
        setColumns([]);
        setPreview(null);
      } else {
        setNotice(`El dataset '${activeDataset.name}' ha sido archivado correctamente.`);
      }
      setShowDeleteModal(false);
      await refresh();
    });
  }

  async function handleUnarchive() {
    if (!activeDataset) return;
    await run(async () => {
      await api(`/datasets/${activeDataset.id}/unarchive`, datasetLifecycleResultSchema, {
        method: 'POST',
      });
      setNotice(`El dataset '${activeDataset.name}' ha sido reactivado.`);
      await refresh();
    });
  }

  useEffect(() => {
    void refresh(showArchived);
  }, [showArchived]);

  useEffect(() => {
    void (async () => {
      try {
        setSession(await api('/auth/session', sessionSchema));
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo cargar la sesión.');
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    void api(`/datasets/${selected}/versions`, versionListSchema)
      .then(result => {
        if (active) setVersions(result.items);
      })
      .catch(e => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [selected, version?.state, version?.publishedAt]);

  // Polling for processing state
  useEffect(() => {
    if (!version || !['profiling', 'validating', 'importing'].includes(version.state)) return;
    let active = true;
    let consecutiveFailures = 0;
    const timer = setInterval(() => {
      void api(`/uploads/${version.id}`, versionSchema)
        .then(result => {
          if (active) {
            consecutiveFailures = 0;
            setVersion(result);
            if (result.state === 'awaiting_mapping' && result.profile) {
              setupColumnsFromProfile(result, result.profile.sheets[0]?.name ?? '');
            }
          }
        })
        .catch(e => {
          consecutiveFailures++;
          if (active && consecutiveFailures >= 3) {
            setError(e instanceof Error ? e.message : String(e));
          }
        });
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [version?.id, version?.state]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  }

  async function createDataset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const item = await api('/datasets', datasetSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ name: form.get('name'), slug: form.get('slug') }),
      });
      await refresh();
      setSelected(item.id);
      setVersion(null);
      setColumns([]);
      setPreview(null);
      setShowCreateDataset(false);
      setNotice(`Dataset "${item.name}" creado con éxito. Ya puedes cargar la primera versión.`);
    });
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return;

    await run(async () => {
      const format = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
      const result = await api(`/datasets/${selected}/uploads`, uploadResultSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ filename: file.name, bytes: file.size, format, regional }),
      });
      setVersion(result.version);
      setColumns([]);
      setPreview(null);
      const sent = await fetch(result.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (!sent.ok) throw new Error('No se pudo transferir el archivo. Inicia una nueva carga.');
      const confirmed = await api(`/uploads/${result.version.id}/confirm`, versionSchema, { method: 'POST' });
      setVersion(confirmed);
      setNotice('Archivo subido exitosamente. El analizador está extrayendo columnas y muestras...');
    });
  }

  function setupColumnsFromProfile(v: DatasetVersion, sheetName: string) {
    setSelectedSheet(sheetName);
    const sheet = v.profile?.sheets.find(s => s.name === sheetName) ?? v.profile?.sheets[0];
    if (!sheet) return;

    const existingMapping = v.mapping?.sheet === sheet.name ? v.mapping : null;
    if (existingMapping) {
      setStrategy(existingMapping.strategy);
      setErrorPolicy(existingMapping.errorPolicy ?? 'strict');
    }

    const configs: ColumnConfig[] = sheet.suggested.map((s, idx) => {
      const mapped = existingMapping?.fields.find(f => f.source === s.source);
      let sampleVal: string | null = null;
      for (const row of sheet.sample) {
        if (row[idx] !== null && row[idx] !== undefined && row[idx] !== '') {
          sampleVal = String(row[idx]);
          break;
        }
      }
      return {
        source: s.source,
        target: mapped?.target ?? s.target,
        type: mapped?.type ?? s.type,
        required: mapped?.required ?? s.required,
        isKey: existingMapping ? existingMapping.keyFields.includes(mapped?.target ?? '') : false,
        included: existingMapping ? Boolean(mapped) : true,
        sample: sampleVal,
      };
    });

    setColumns(configs);
  }

  async function inspect(item: DatasetVersion) {
    await run(async () => {
      const fresh = await api(`/uploads/${item.id}`, versionSchema);
      setVersion(fresh);
      setRegional(fresh.mapping?.regional ?? fresh.regional);
      setPreview(null);

      // Load issues if any
      if (fresh.issueCount > 0) {
        try {
          const report = await api(`/uploads/${item.id}/issues`, issueReportSchema);
          setIssues(report.items);
        } catch {
          setIssues(fresh.issues);
        }
      } else {
        setIssues([]);
      }

      // Initialize mapping editor if profile exists
      if (fresh.profile && fresh.profile.sheets.length > 0) {
        const sheetName = fresh.mapping?.sheet ?? fresh.profile.sheets[0]?.name ?? '';
        setupColumnsFromProfile(fresh, sheetName);
      } else {
        setColumns([]);
      }

      // Load preview if published or ready
      if (fresh.mapping && (fresh.state === 'ready' || fresh.publishedAt)) {
        try {
          setPreview(await api(`/uploads/${fresh.id}/preview`, dataPreviewSchema));
        } catch {
          setPreview(null);
        }
      }

      // Smooth scroll to the inspector panel
      setTimeout(() => {
        document.getElementById('version-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    });
  }

  async function retryProfile(versionId: string) {
    await run(async () => {
      const updated = await api(`/uploads/${versionId}/retry-profile`, versionSchema, { method: 'POST' });
      setVersion(updated);
      setNotice('Reanálisis iniciado. El worker está procesando nuevamente el archivo...');
    });
  }

  async function submitMapping(policyOverride?: ErrorPolicy) {
    if (!version) return;
    const activePolicy = policyOverride ?? errorPolicy;
    if (policyOverride) {
      setErrorPolicy(policyOverride);
    }
    const included = columns.filter(c => c.included);
    if (!included.length) {
      throw new Error('Debes seleccionar al menos una columna para importar.');
    }
    const payload: Mapping = {
      sheet: selectedSheet,
      fields: included.map(c => ({
        source: c.source,
        target: c.target,
        type: c.type,
        required: c.required,
      })),
      keyFields: included.filter(c => c.isKey).map(c => c.target),
      strategy,
      errorPolicy: activePolicy,
      regional,
    };

    await run(async () => {
      const updated = await api(`/uploads/${version.id}/mapping`, versionSchema, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setVersion(updated);
      setNotice(
        activePolicy === 'nullify'
          ? 'Validando datos con reemplazo de errores a NULL...'
          : activePolicy === 'skip'
          ? 'Validando datos omitiendo filas con errores...'
          : 'Validación encolada. El worker está normalizando las filas...'
      );
    });
  }

  async function publishVersion(targetVersion: DatasetVersion) {
    await run(async () => {
      const pub = await api(`/uploads/${targetVersion.id}/publish`, versionSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setVersion(pub);
      await refresh();
      setNotice(`Versión v${targetVersion.number} publicada como vigente exitosamente. Ya puedes definir KPIs y dashboards sobre estos datos.`);
    });
  }

  const colIssues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const issue of issues) {
      map[issue.field] = (map[issue.field] ?? 0) + 1;
    }
    return map;
  }, [issues]);

  const issueStats = useMemo(() => {
    if (!issues.length) return null;
    const byCode: Record<string, number> = {};
    const byField: Record<string, number> = {};
    const rowSamples: { row: number; field: string; code: string }[] = [];
    for (const issue of issues) {
      byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
      byField[issue.field] = (byField[issue.field] ?? 0) + 1;
      if (rowSamples.length < 10) rowSamples.push(issue);
    }
    return { byCode, byField, rowSamples, total: issues.length };
  }, [issues]);

  const filteredColumns = useMemo(() => {
    if (!columnSearch.trim()) return columns;
    const q = columnSearch.toLowerCase();
    return columns.filter(c => c.source.toLowerCase().includes(q) || c.target.toLowerCase().includes(q));
  }, [columns, columnSearch]);

  const filteredIssues = useMemo(() => {
    if (!issueSearch.trim()) return issues;
    const q = issueSearch.toLowerCase();
    return issues.filter(issue => issue.field.toLowerCase().includes(q) || String(issue.row).includes(q) || issue.code.toLowerCase().includes(q));
  }, [issues, issueSearch]);

  const includedCount = useMemo(() => columns.filter(c => c.included).length, [columns]);
  const errorColumnsCount = useMemo(() => Object.keys(colIssues).length, [colIssues]);

  return (
    <>
      <AppHeader session={session} />

      <main id="main" className="workspace data-workspace">
        <div className="breadcrumb">Espacio de trabajo / Datasets</div>
        <div className="title-row">
          <div>
            <span className="eyebrow secondary">Datos de tu operación</span>
            <h1>Datasets</h1>
            <p>Gestiona y define tus datasets, selecciona las columnas a importar y publica versiones gobernadas.</p>
          </div>
          {manage && (
            <div className="actions">
              <button
                className="button primary"
                onClick={() => setShowCreateDataset(!showCreateDataset)}
                aria-expanded={showCreateDataset}
              >
                {showCreateDataset ? 'Cerrar formulario' : '+ Definir nuevo dataset'}
              </button>
            </div>
          )}
        </div>

        {error && <p role="alert" className="form-error">{error}</p>}
        {notice && <p role="status" className="notice-banner" style={{ background: 'var(--surface)', padding: '12px 16px', borderLeft: '3px solid var(--accent)', margin: '16px 0' }}>{notice}</p>}

        {/* Creador explícito de dataset */}
        {showCreateDataset && manage && (
          <section className="panel data-card" style={{ border: '1px solid var(--border-strong)' }}>
            <h2>Definir un nuevo dataset</h2>
            <p className="secondary">
              Un dataset representa una tabla o entidad lógica de tu operación (por ejemplo: <code>Llamadas</code>, <code>Encuestas CSAT</code>, <code>Adherencia</code>).
            </p>
            <form onSubmit={event => { void createDataset(event); }} className="data-grid" style={{ marginTop: '16px' }}>
              <label className="field">
                Nombre del dataset
                <input name="name" required minLength={2} maxLength={120} placeholder="Ej. Encuestas de Calidad (CSAT)" />
              </label>
              <label className="field">
                Identificador técnico (slug)
                <input name="slug" required pattern="[a-z][a-z0-9_]{1,62}" placeholder="csat_encuestas" title="Solo minúsculas, números y guión bajo (2 a 63 caracteres)" />
              </label>
              <div>
                <button className="button primary" disabled={busy}>
                  {busy ? 'Creando...' : 'Crear dataset'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Selector y Resumen del Dataset activo */}
        <section className="panel data-card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
              />
              <span>Mostrar datasets archivados</span>
            </label>
          </div>

          <div className="data-grid" style={{ alignItems: 'center' }}>
            <label className="field" style={{ margin: 0 }}>
              Dataset seleccionado
              <select
                value={selected}
                onChange={event => {
                  setSelected(event.target.value);
                  setVersion(null);
                  setColumns([]);
                  setPreview(null);
                  setIssues([]);
                }}
              >
                <option value="">-- Elige un dataset para trabajar --</option>
                {datasets.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.slug}){item.archivedAt ? ' [Archivado]' : ''}
                  </option>
                ))}
              </select>
            </label>
            {activeDataset && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--secondary)', alignItems: 'center' }}>
                  <div><strong>Slug:</strong> <code>{activeDataset.slug}</code></div>
                  <div><strong>Versión actual:</strong> {activeDataset.currentVersionId ? 'Activa' : 'Sin versión publicada'}</div>
                  <div><strong>Historial:</strong> {versions.length} versiones registradas</div>
                  {activeDataset.archivedAt && (
                    <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '12px' }}>
                      Archivado
                    </span>
                  )}
                </div>
                {manage && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {activeDataset.archivedAt ? (
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={() => { void handleUnarchive(); }}
                        style={{ fontSize: '13px' }}
                      >
                        Reactivar dataset
                      </button>
                    ) : (
                      <>
                        {hasPublishedVersions && (
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() => openAiModal()}
                            style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            title="Crear una nueva versión con columna calculada por IA"
                          >
                            <span>✨</span>
                            <span>Columna con IA</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => setShowDeleteModal(true)}
                          style={{ fontSize: '13px', color: '#b91c1c', borderColor: '#fca5a5' }}
                          title={hasPublishedVersions ? 'Archivar dataset gobernado' : 'Eliminar dataset borrador'}
                        >
                          {hasPublishedVersions ? 'Archivar dataset' : 'Eliminar dataset'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {showDeleteModal && activeDataset && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
            <div className="panel" style={{ background: 'var(--surface, #ffffff)', padding: '24px', borderRadius: '8px', maxWidth: '520px', width: '100%', border: '1px solid var(--border-strong)' }}>
              <h3 style={{ marginTop: 0, fontSize: '18px' }}>
                {hasPublishedVersions ? '¿Archivar dataset gobernado?' : '¿Eliminar dataset definitivamente?'}
              </h3>
              <p style={{ color: 'var(--secondary)', lineHeight: 1.5, fontSize: '14px' }}>
                {hasPublishedVersions ? (
                  <>
                    El dataset <strong>{activeDataset.name}</strong> contiene versiones publicadas. Para garantizar la inmutabilidad histórica y trazabilidad de ATLAS, el dataset será <strong>archivado</strong>. Se ocultará de la lista habitual y no admitirá nuevos archivos ni KPIs, pero los cálculos históricos continuarán funcionando.
                  </>
                ) : (
                  <>
                    El dataset <strong>{activeDataset.name}</strong> no tiene versiones publicadas. Se <strong>eliminará permanentemente</strong> de la base de datos junto con sus archivos cargados. Esta acción no se puede deshacer.
                  </>
                )}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button primary"
                  style={{ background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' }}
                  disabled={busy}
                  onClick={() => { void handleDeleteOrArchive(); }}
                >
                  {busy ? 'Procesando...' : hasPublishedVersions ? 'Confirmar y archivar' : 'Confirmar y eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Diálogo Columna Asistida con IA */}
        {showAiModal && activeDataset && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
            <div className="panel" style={{ background: 'var(--surface, #ffffff)', padding: '24px', borderRadius: '8px', maxWidth: '780px', width: '100%', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border-strong)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>✨</span>
                    <span>Agregar Columna Asistida con IA</span>
                  </h3>
                  <p style={{ margin: '4px 0 0 0', color: 'var(--secondary)', fontSize: '13px' }}>
                    Genera una nueva versión inmutable con datos enriquecidos mediante inferencia semántica por lotes.
                  </p>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => setShowAiModal(false)}
                  style={{ padding: '4px 10px', fontSize: '14px', lineHeight: 1 }}
                  title="Cerrar modal"
                >
                  ✕
                </button>
              </div>

              {/* Selector de versión base */}
              <div style={{ marginBottom: '16px', background: 'var(--surface-muted)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--secondary)' }}>
                  VERSIÓN BASE ORIGEN (INMUTABLE)
                </label>
                {eligibleVersions.length > 0 ? (
                  <select
                    value={aiBaseVersionId}
                    onChange={e => {
                      const newId = e.target.value;
                      setAiBaseVersionId(newId);
                      const b = versions.find(v => v.id === newId);
                      if (b) {
                        const cols = extractColumnsFromVersion(b);
                        setAiSourceCols(cols.slice(0, Math.min(3, cols.length)));
                        setAiPreviewResult(null);
                      }
                    }}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '13px' }}
                  >
                    {eligibleVersions.map(v => (
                      <option key={v.id} value={v.id}>
                        v{v.number} — {v.filename} ({v.rows.toLocaleString()} filas {v.publishedAt ? '· Publicada' : '· Lista'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p style={{ margin: 0, color: 'var(--negative)', fontSize: '13px' }}>
                    No hay versiones listas o publicadas para este dataset.
                  </p>
                )}
              </div>

              {/* Plantillas rápidas de Call Center */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--secondary)' }}>
                  PLANTILLAS RÁPIDAS (CALL CENTER / OPERACIONAL)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
                  {AI_TEMPLATES.map(tpl => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applyAiTemplate(tpl)}
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        background: aiTargetColumn === tpl.targetColumn ? 'var(--surface-muted)' : 'var(--surface)',
                        cursor: 'pointer',
                        borderColor: aiTargetColumn === tpl.targetColumn ? 'var(--accent)' : 'var(--border)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{tpl.icon}</span>
                        <span>{tpl.name}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--secondary)', marginTop: '2px' }}>
                        {tpl.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Campos: Columna destino y Tipo */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    Nombre de la Columna Destino *
                  </label>
                  <input
                    type="text"
                    value={aiTargetColumn}
                    onChange={e => {
                      setAiTargetColumn(e.target.value);
                      setAiPreviewResult(null);
                    }}
                    placeholder="ej. sentimiento_cliente"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '13px' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--secondary)', marginTop: '4px', display: 'block' }}>
                    Minúsculas, números y guiones bajos (ej. <code>motivo_resumido</code>).
                  </span>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    Tipo de Dato Resultado *
                  </label>
                  <select
                    value={aiTargetType}
                    onChange={e => {
                      setAiTargetType(e.target.value as 'string' | 'integer' | 'decimal' | 'boolean');
                      setAiPreviewResult(null);
                    }}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '13px', background: 'var(--surface)' }}
                  >
                    <option value="string">Texto / Categoría (string)</option>
                    <option value="integer">Número Entero (integer, ej. 1 a 5)</option>
                    <option value="decimal">Decimal / Ratio (decimal)</option>
                    <option value="boolean">Booleano Verdadero/Falso (boolean)</option>
                  </select>
                  <span style={{ fontSize: '11px', color: 'var(--secondary)', marginTop: '4px', display: 'block' }}>
                    Estructura tipada que validará el motor de IA.
                  </span>
                </div>
              </div>

              {/* Columnas de contexto (Checkbox list) */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Columnas de Contexto a enviar a la IA ({aiSourceCols.length} seleccionadas) *
                  </label>
                  {availableAiSourceColumns.length > 0 && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        if (aiSourceCols.length === availableAiSourceColumns.length) {
                          setAiSourceCols([]);
                        } else {
                          setAiSourceCols([...availableAiSourceColumns]);
                        }
                        setAiPreviewResult(null);
                      }}
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                    >
                      {aiSourceCols.length === availableAiSourceColumns.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                    </button>
                  )}
                </div>
                {availableAiSourceColumns.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '120px', overflowY: 'auto', padding: '8px', background: 'var(--surface-muted)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    {availableAiSourceColumns.map((col: string) => {
                      const checked = aiSourceCols.includes(col);
                      return (
                        <label
                          key={col}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            background: checked ? 'var(--accent)' : 'var(--surface)',
                            color: checked ? '#fff' : 'inherit',
                            fontSize: '12px',
                            cursor: 'pointer',
                            userSelect: 'none',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAiSourceCol(col)}
                            style={{ display: 'none' }}
                          />
                          <span>{checked ? '✓' : '+'}</span>
                          <span style={{ fontFamily: 'monospace' }}>{col}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--secondary)' }}>
                    No se encontraron columnas en la versión seleccionada.
                  </p>
                )}
                <span style={{ fontSize: '11px', color: 'var(--secondary)', marginTop: '4px', display: 'block' }}>
                  Solo los valores de las columnas seleccionadas serán procesados para optimizar tokens y privacidad.
                </span>
              </div>

              {/* Prompt / Instrucción */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  Instrucción / Prompt para el Modelo de IA *
                </label>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={e => {
                    setAiPrompt(e.target.value);
                    setAiPreviewResult(null);
                  }}
                  placeholder="Explica qué inferir o calcular (ej. Determina si el cliente expresó molestia en una escala del 1 al 5...)"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '13px', resize: 'vertical' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--secondary)', marginTop: '4px', display: 'block' }}>
                  El motor aplicará esta regla fila por fila en lotes de procesamiento con salida JSON estructurada y segura.
                </span>
              </div>

              {/* Configuración de Batch Size y Motor */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    Tamaño de Lote (Batching)
                  </label>
                  <select
                    value={aiBatchSize}
                    onChange={e => setAiBatchSize(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '13px', background: 'var(--surface)' }}
                  >
                    <option value={50}>50 filas por llamada (conservador)</option>
                    <option value={100}>100 filas por llamada (Recomendado)</option>
                    <option value={150}>150 filas por llamada (alta velocidad)</option>
                  </select>
                </div>
                <div style={{ padding: '10px 14px', background: 'var(--surface-muted)', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '12px' }}>
                  <span style={{ fontWeight: 600, display: 'block', marginBottom: '2px' }}>Motor Semántico</span>
                  <span style={{ color: 'var(--secondary)' }}>Google Gemini 2.5 Flash / Modo Offline Determinista</span>
                </div>
              </div>

              {/* Errores de previsualización */}
              {aiPreviewError && (
                <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', color: '#b91c1c', fontSize: '13px', marginBottom: '16px' }}>
                  {aiPreviewError}
                </div>
              )}

              {/* Sección de Previsualización (3 filas) */}
              <div style={{ marginBottom: '20px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🧪</span>
                    <span>Previsualización en tiempo real (3 filas de muestra)</span>
                  </div>
                  <button
                    type="button"
                    className="button"
                    disabled={aiPreviewBusy || aiCreateBusy || aiSourceCols.length === 0}
                    onClick={() => { void handleAiPreview(); }}
                    style={{ fontSize: '12px', padding: '4px 12px' }}
                  >
                    {aiPreviewBusy ? 'Evaluando con IA...' : '🧪 Previsualizar con IA'}
                  </button>
                </div>

                <div style={{ padding: '12px' }}>
                  {aiPreviewBusy ? (
                    <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--secondary)', fontSize: '13px' }}>
                      <p style={{ margin: 0 }}>Consultando motor de IA con las 3 primeras filas...</p>
                    </div>
                  ) : aiPreviewResult ? (
                    <div className="table-wrapper" style={{ margin: 0 }}>
                      <table style={{ fontSize: '12px', width: '100%' }}>
                        <thead>
                          <tr>
                            <th style={{ width: '60px' }}>Fila #</th>
                            <th>Entradas analizadas ({aiSourceCols.join(', ')})</th>
                            <th style={{ width: '200px' }}>
                              Columna IA: <code>{aiPreviewResult.targetColumn}</code>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiPreviewResult.sampleRows.map(sample => (
                            <tr key={sample.rowNumber}>
                              <td><strong>#{sample.rowNumber}</strong></td>
                              <td>
                                <div style={{ maxHeight: '60px', overflowY: 'auto', fontSize: '11px', lineHeight: 1.4 }}>
                                  {Object.entries(sample.inputs).map(([k, v]) => (
                                    <div key={k}>
                                      <span style={{ color: 'var(--secondary)' }}>{k}:</span> <code>{String(v ?? 'null')}</code>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td style={{ verticalAlign: 'middle' }}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  background: sample.computedValue !== null ? 'var(--surface-muted)' : '#fef2f2',
                                  fontWeight: 600,
                                  color: sample.computedValue !== null ? 'var(--accent)' : 'var(--negative)',
                                  border: '1px solid var(--border)',
                                }}>
                                  {sample.computedValue !== null ? String(sample.computedValue) : 'null'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--secondary)', textAlign: 'center', padding: '12px' }}>
                      Presiona <strong>&quot;Previsualizar con IA&quot;</strong> para probar el prompt y verificar el tipo de dato inferido antes de enriquecer todas las filas.
                    </p>
                  )}
                </div>
              </div>

              {/* Botones de acción del Modal */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                <button
                  type="button"
                  className="button"
                  disabled={aiCreateBusy}
                  onClick={() => setShowAiModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={aiCreateBusy || aiPreviewBusy || aiSourceCols.length === 0}
                  onClick={() => { void handleAiGenerate(); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  {aiCreateBusy ? (
                    <>
                      <span>⏳</span>
                      <span>Creando versión...</span>
                    </>
                  ) : (
                    <>
                      <span>✨</span>
                      <span>Generar versión con columna IA</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sección de carga de archivo */}
        {selected && manage && (
          <section className="panel data-card">
            <h2>Importar una versión para {activeDataset?.name}</h2>
            <p className="secondary">Carga un archivo CSV o XLSX de hasta 250 MB. Podrás elegir exactamente qué columnas importar en el paso siguiente.</p>
            <form onSubmit={event => { void upload(event); }}>
              <div className="data-grid">
                <label className="field">
                  Archivo Excel o CSV
                  <input type="file" name="file" accept=".csv,.xlsx" required />
                </label>
                <label className="field">
                  Separador decimal
                  <select
                    value={regional.decimalSeparator}
                    onChange={event => setRegional({ ...regional, decimalSeparator: event.target.value as '.' | ',', thousandsSeparator: 'none' })}
                  >
                    <option value=".">Punto · 1234.56</option>
                    <option value=",">Coma · 1234,56</option>
                  </select>
                </label>
                <label className="field">
                  Separador de miles
                  <select
                    value={regional.thousandsSeparator}
                    onChange={event => setRegional({ ...regional, thousandsSeparator: event.target.value as Regional['thousandsSeparator'] })}
                  >
                    <option value="none">Sin separador</option>
                    <option value="," disabled={regional.decimalSeparator === ','}>Coma</option>
                    <option value="." disabled={regional.decimalSeparator === '.'}>Punto</option>
                    <option value=" ">Espacio</option>
                  </select>
                </label>
                <label className="field">
                  Formato de fecha
                  <select
                    value={regional.dateFormat}
                    onChange={event => setRegional({ ...regional, dateFormat: event.target.value as Regional['dateFormat'] })}
                  >
                    <option value="DD/MM/YYYY">Día / mes / año (DD/MM/YYYY)</option>
                    <option value="MM/DD/YYYY">Mes / día / año (MM/DD/YYYY)</option>
                    <option value="YYYY-MM-DD">Año-mes-día (ISO YYYY-MM-DD)</option>
                  </select>
                </label>
                <label className="field">
                  Zona horaria
                  <input
                    value={regional.timezone}
                    onChange={event => setRegional({ ...regional, timezone: event.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  Separador CSV
                  <select
                    value={regional.delimiter}
                    onChange={event => setRegional({ ...regional, delimiter: event.target.value as Regional['delimiter'] })}
                  >
                    <option value=",">Coma (,)</option>
                    <option value=";">Punto y coma (;)</option>
                    <option value={'\t'}>Tabulación</option>
                  </select>
                </label>
              </div>
              <div style={{ marginTop: '16px' }}>
                <button disabled={busy} className="button primary">
                  {busy ? 'Procesando subida...' : 'Cargar y analizar archivo'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Historial de versiones */}
        {selected && (
          <section className="panel data-card">
            <h2>Historial de versiones</h2>
            {versions.length === 0 ? (
              <p className="secondary">No hay versiones cargadas para este dataset todavía.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Versión</th>
                      <th>Archivo</th>
                      <th>Estado</th>
                      <th className="number">Filas</th>
                      <th>Fecha de carga</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map(item => {
                      const isCurrent = datasets.find(d => d.id === selected)?.currentVersionId === item.id;
                      const isSelectedVersion = version?.id === item.id;
                      return (
                        <tr key={item.id} style={isSelectedVersion ? { background: 'var(--surface-muted)' } : undefined}>
                          <td>
                            <strong>v{item.number}</strong>
                            {isCurrent && <span style={{ marginLeft: '8px', padding: '2px 6px', background: 'var(--accent)', color: '#fff', fontSize: '10px' }}>Vigente</span>}
                          </td>
                          <td>{item.filename}</td>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: item.publishedAt ? 'var(--positive)' : item.state === 'failed' ? 'var(--negative)' : item.state === 'ready' ? 'var(--accent)' : 'var(--warning)'
                              }} />
                              {item.publishedAt ? 'Publicada' : states[item.state]}
                            </span>
                          </td>
                          <td className="number">{item.rows.toLocaleString()}</td>
                          <td>{new Date(item.createdAt).toLocaleString()}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() => { void inspect(item); }}
                                title={`Abrir inspector para la versión ${item.number}`}
                              >
                                Revisar v{item.number}
                              </button>
                              {manage && (item.publishedAt || item.state === 'ready') && (
                                <button
                                  className="button"
                                  disabled={busy}
                                  onClick={() => openAiModal(item)}
                                  title={`Crear columna con IA basada en v${item.number}`}
                                  style={{ padding: '6px 10px', fontSize: '12px' }}
                                >
                                  ✨ IA
                                </button>
                              )}
                              {manage && item.state === 'ready' && !item.publishedAt && (
                                <button
                                  className="button primary"
                                  disabled={busy}
                                  onClick={() => { void publishVersion(item); }}
                                  title={`Publicar directamente la versión ${item.number}`}
                                  style={{ padding: '6px 12px' }}
                                >
                                  Publicar v{item.number}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Panel Inspector de Versión */}
        {version && (
          <section id="version-inspector" className="panel data-card" style={{ border: '2px solid var(--border-strong)', scrollMarginTop: '80px' }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
              <div>
                <span className="eyebrow secondary">Inspección de versión</span>
                <h2>Versión {version.number} · {version.filename}</h2>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{
                  padding: '6px 12px',
                  background: version.publishedAt ? 'var(--positive)' : version.state === 'failed' ? 'var(--negative)' : 'var(--surface-muted)',
                  color: version.publishedAt || version.state === 'failed' ? '#fff' : 'inherit',
                  fontWeight: 600,
                  fontSize: '12px'
                }}>
                  {version.publishedAt ? 'Publicada' : states[version.state]}
                </span>
                {manage && version.state === 'ready' && !version.publishedAt && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => { void publishVersion(version); }}
                    style={{ padding: '6px 16px', fontSize: '13px' }}
                  >
                    Publicar versión v{version.number}
                  </button>
                )}
              </div>
            </div>

            {/* Metadatos */}
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', padding: '12px', background: 'var(--surface-muted)', fontSize: '12px', marginBottom: '16px' }}>
              <div><strong>Tamaño:</strong> {(version.bytes / 1024).toFixed(1)} KB</div>
              <div><strong>Filas procesadas:</strong> {version.rows.toLocaleString()}</div>
              <div><strong>Errores detectados:</strong> {version.issueCount}</div>
              {version.sha256 && <div><strong>SHA-256:</strong> <code style={{ fontSize: '10px' }}>{version.sha256.slice(0, 16)}...</code></div>}
            </div>

            {/* Mensaje de procesamiento activo */}
            {['profiling', 'validating', 'importing'].includes(version.state) && (
              <div style={{ padding: '16px', background: 'var(--surface)', borderLeft: '4px solid var(--accent)', margin: '16px 0', borderRadius: '4px' }}>
                {version.profile?.aiColumnConfig ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <p style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>✨</span>
                        <span>Generando columna con IA: <code>{version.profile.aiColumnConfig.targetColumn}</code> ({version.progress}%)</span>
                      </p>
                      <span style={{ fontSize: '12px', color: 'var(--secondary)' }}>
                        {version.rows.toLocaleString()} filas enriquecidas
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '8px', background: 'var(--surface-muted)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, version.progress)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s ease' }} />
                    </div>
                    <p className="secondary" style={{ marginTop: '8px', fontSize: '12px' }}>
                      El worker está enriqueciendo los registros con IA en segundo plano. Puedes continuar navegando; la vista se actualizará automáticamente al completar.
                    </p>
                  </>
                ) : (
                  <>
                    <p><strong>Procesamiento en segundo plano en curso ({version.progress}%):</strong> {states[version.state]}</p>
                    <p className="secondary" style={{ marginTop: '4px' }}>El worker está analizando tu archivo. Puedes continuar navegando; el progreso se actualizará automáticamente.</p>
                  </>
                )}
              </div>
            )}

            {/* Error banner específico y descriptivo */}
            {version.errorCode && (
              <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--negative)', borderLeft: '5px solid var(--negative)', margin: '16px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <p style={{ color: 'var(--negative)', fontWeight: 700, fontSize: '15px' }}>
                      Atención: La versión no puede publicarse ({version.errorCode})
                    </p>
                    <p style={{ marginTop: '6px', fontSize: '13px' }}>{humanizeError(version.errorCode)}</p>
                  </div>
                </div>

                {/* Desglose estadístico específico de las incidencias */}
                {issueStats && (
                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)', fontSize: '13px' }}>
                    <p><strong>Diagnóstico de las {version.issueCount} incidencias encontradas:</strong></p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '10px' }}>
                      <div style={{ background: 'var(--surface-muted)', padding: '12px', border: '1px solid var(--border)' }}>
                        <p style={{ fontWeight: 600, marginBottom: '6px' }}>Tipos de error detectados:</p>
                        <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
                          {Object.entries(issueStats.byCode).map(([code, count]) => (
                            <li key={code}>
                              <strong>{count} {count === 1 ? 'celda' : 'celdas'}:</strong> {humanizeError(code)}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div style={{ background: 'var(--surface-muted)', padding: '12px', border: '1px solid var(--border)' }}>
                        <p style={{ fontWeight: 600, marginBottom: '6px' }}>Columnas que contienen errores:</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {Object.entries(issueStats.byField).map(([field, count]) => (
                            <span key={field} style={{ padding: '3px 8px', background: 'var(--surface)', border: '1px solid var(--border-strong)', fontSize: '12px' }}>
                              <code>{field}</code>: <strong>{count}</strong> {count === 1 ? 'error' : 'errores'}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '12px', color: 'var(--secondary)', fontSize: '12px' }}>
                      <strong>Primeras filas afectadas en el archivo:</strong>{' '}
                      {issueStats.rowSamples.map((s, i) => (
                        <span key={i} style={{ display: 'inline-block', marginRight: '10px' }}>
                          Fila {s.row} (<code>{s.field}</code>)
                        </span>
                      ))}
                    </div>

                    {/* Acciones recomendadas para resolver las incidencias */}
                    {manage && !version.publishedAt && version.profile && (
                      <div style={{ marginTop: '18px', padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px' }}>
                        <p style={{ fontWeight: 700, margin: '0 0 6px 0', fontSize: '14px' }}>
                          ⚡ Acciones recomendadas para corregir y publicar:
                        </p>
                        <p className="secondary" style={{ margin: '0 0 12px 0', fontSize: '12px' }}>
                          Puedes aplicar una de las siguientes soluciones automáticas sin necesidad de editar manualmente el archivo de Excel:
                        </p>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="button primary"
                            disabled={busy}
                            onClick={() => { void submitMapping('nullify'); }}
                            title="Convierte los errores de fórmulas (#N/A, celdas vacías) en valores NULL en campos opcionales y revalida"
                            style={{ background: 'var(--accent)', color: '#fff' }}
                          >
                            Convertir errores a NULL y revalidar
                          </button>
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() => { void submitMapping('skip'); }}
                            title="Descarta las filas que contienen errores e importa únicamente las filas limpias"
                          >
                            Omitir filas con errores y revalidar
                          </button>
                          {errorColumnsCount > 0 && (
                            <button
                              type="button"
                              className="button"
                              disabled={busy}
                              onClick={() => {
                                setColumns(cols => cols.map(c => ({ ...c, included: !colIssues[c.source], isKey: !colIssues[c.source] ? c.isKey : false })));
                                setNotice(`Se desmarcaron ${errorColumnsCount} columnas con errores.`);
                              }}
                              title="Deselecciona automáticamente las columnas afectadas en la lista de abajo"
                            >
                              Excluir columnas con errores ({errorColumnsCount})
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {manage && !version.publishedAt && !version.profile && (
                  <div style={{ marginTop: '14px' }}>
                    <button className="button primary" disabled={busy} onClick={() => { void retryProfile(version.id); }}>
                      Reanalizar archivo con corrección de encabezados
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Reporte de errores detallado (colocado inmediatamente visible) */}
            {issues.length > 0 && (
              <div id="reporte-errores" style={{ margin: '20px 0', border: '1px solid var(--border)', padding: '16px', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Reporte detallado de errores ({version.issueCount} incidencias)</h3>
                    <p className="secondary" style={{ margin: '4px 0 0' }}>Mostrando los primeros {issues.length} errores registrados durante la validación de filas:</p>
                  </div>
                  <div>
                    <input
                      type="search"
                      placeholder="Filtrar por columna o fila..."
                      value={issueSearch}
                      onChange={e => setIssueSearch(e.target.value)}
                      style={{ padding: '6px 10px', fontSize: '12px', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>

                <div className="table-scroll" style={{ maxHeight: '280px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '110px' }}>Fila origen</th>
                        <th style={{ width: '180px' }}>Columna del archivo</th>
                        <th>Detalle de la falla</th>
                        <th style={{ width: '140px' }}>Código técnico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIssues.map((issue, i) => (
                        <tr key={i}>
                          <td><strong>Fila {issue.row}</strong></td>
                          <td><code>{issue.field}</code></td>
                          <td style={{ color: 'var(--negative)' }}>{humanizeError(issue.code)}</td>
                          <td><code style={{ fontSize: '11px', color: 'var(--secondary)' }}>{issue.code}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Mapeo y Selección de Columnas */}
            {manage && version.profile && !version.publishedAt && ['awaiting_mapping', 'failed'].includes(version.state) && (
              <div style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                  <h3>Configuración y selección de columnas a importar</h3>
                  {version.profile.sheets.length > 1 && (
                    <label className="field" style={{ margin: 0, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                      <span>Hoja:</span>
                      <select value={selectedSheet} onChange={e => setupColumnsFromProfile(version, e.target.value)}>
                        {version.profile.sheets.map(s => <option key={s.name} value={s.name}>{s.name} ({s.rows} filas)</option>)}
                      </select>
                    </label>
                  )}
                </div>

                <p className="secondary" style={{ marginBottom: '16px' }}>
                  Elige qué columnas deseas incluir en el dataset. Si alguna columna contiene errores de fórmulas en Excel (como <code>#N/A</code>) y no la requieres, puedes desmarcarla aquí para publicar sin errores.
                </p>

                {/* Toolbar de selección de columnas */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', padding: '12px', background: 'var(--surface-muted)', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setColumns(cols => cols.map(c => ({ ...c, included: true })))}
                    >
                      Seleccionar todas
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setColumns(cols => cols.map(c => ({ ...c, included: false, isKey: false })))}
                    >
                      Deseleccionar todas
                    </button>
                    {errorColumnsCount > 0 && (
                      <button
                        type="button"
                        className="button"
                        style={{ border: '1px solid var(--negative)', color: 'var(--negative)' }}
                        onClick={() => setColumns(cols => cols.map(c => ({ ...c, included: !colIssues[c.source], isKey: !colIssues[c.source] ? c.isKey : false })))}
                        title="Deselecciona automáticamente las columnas que generaron errores"
                      >
                        Excluir columnas con errores ({errorColumnsCount})
                      </button>
                    )}
                    <span style={{ fontSize: '13px', marginLeft: '8px' }}>
                      <strong>{includedCount}</strong> de {columns.length} columnas seleccionadas
                    </span>
                  </div>
                  <div>
                    <input
                      type="search"
                      placeholder="Buscar columna..."
                      value={columnSearch}
                      onChange={e => setColumnSearch(e.target.value)}
                      style={{ padding: '6px 10px', fontSize: '12px', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>

                {/* Tabla interactiva de columnas */}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '60px', textAlign: 'center' }}>Incluir</th>
                        <th>Columna origen</th>
                        <th>Muestra de datos</th>
                        <th>Campo destino</th>
                        <th>Tipo de dato</th>
                        <th style={{ textAlign: 'center' }}>Obligatorio</th>
                        <th style={{ textAlign: 'center' }}>Clave única</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredColumns.map(col => {
                        const originalIndex = columns.findIndex(c => c.source === col.source);
                        const errCount = colIssues[col.source];
                        return (
                          <tr key={col.source} style={!col.included ? { opacity: 0.5 } : errCount ? { background: 'rgba(154, 67, 61, 0.05)' } : undefined}>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={`Incluir ${col.source}`}
                                checked={col.included}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setColumns(cols => cols.map((c, i) => i === originalIndex ? { ...c, included: checked, isKey: checked ? c.isKey : false } : c));
                                }}
                              />
                            </td>
                            <td>
                              <strong>{col.source}</strong>
                              {errCount && (
                                <span style={{ marginLeft: '8px', padding: '2px 6px', background: 'var(--negative)', color: '#fff', fontSize: '10px', fontWeight: 600 }}>
                                  {errCount} {errCount === 1 ? 'error' : 'errores'}
                                </span>
                              )}
                            </td>
                            <td style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--secondary)', fontSize: '11px', fontFamily: 'monospace' }}>
                              {col.sample ?? '— (vacía)'}
                            </td>
                            <td>
                              <input
                                aria-label={`Campo destino para ${col.source}`}
                                value={col.target}
                                disabled={!col.included}
                                onChange={e => {
                                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                                  setColumns(cols => cols.map((c, i) => i === originalIndex ? { ...c, target: val } : c));
                                }}
                                style={{ width: '180px' }}
                              />
                            </td>
                            <td>
                              <select
                                aria-label={`Tipo para ${col.source}`}
                                value={col.type}
                                disabled={!col.included}
                                onChange={e => {
                                  const val = e.target.value as FieldType;
                                  setColumns(cols => cols.map((c, i) => i === originalIndex ? { ...c, type: val } : c));
                                }}
                              >
                                {fieldTypeSchema.options.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={`Obligatorio ${col.source}`}
                                checked={col.required}
                                disabled={!col.included}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setColumns(cols => cols.map((c, i) => i === originalIndex ? { ...c, required: checked } : c));
                                }}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={`Clave única ${col.source}`}
                                checked={col.isKey}
                                disabled={!col.included}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setColumns(cols => cols.map((c, i) => i === originalIndex ? { ...c, isKey: checked } : c));
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Estrategia de carga y Política de errores */}
                <div style={{ marginTop: '20px', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label className="field" style={{ margin: 0 }}>
                    Estrategia de actualización
                    <select value={strategy} onChange={e => setStrategy(e.target.value as Mapping['strategy'])}>
                      <option value="replace">Reemplazar · Crea una nueva versión completa con estos datos</option>
                      <option value="append">Agregar (Append) · Añade filas nuevas a la versión vigente</option>
                      <option value="upsert">Actualizar o insertar (Upsert) · Requiere al menos una clave única</option>
                    </select>
                  </label>
                  <label className="field" style={{ margin: 0 }}>
                    Tratamiento de errores en celdas
                    <select value={errorPolicy} onChange={e => setErrorPolicy(e.target.value as ErrorPolicy)}>
                      <option value="strict">Estricto · Rechaza la versión si alguna celda tiene errores</option>
                      <option value="nullify">Convertir a NULL · Asigna NULL a celdas con errores (#N/A, etc.) en campos opcionales</option>
                      <option value="skip">Omitir filas · Descarta las filas con errores e importa las limpias</option>
                    </select>
                  </label>
                  <button
                    disabled={busy || includedCount === 0}
                    className="button primary"
                    onClick={() => { void submitMapping(); }}
                  >
                    {busy ? 'Validando datos...' : `Validar datos (${includedCount} columnas seleccionadas)`}
                  </button>
                </div>
              </div>
            )}

            {/* Muestra de filas crudas del archivo */}
            {version.profile && (
              <details style={{ marginTop: '24px' }}>
                <summary><strong>Ver valores de muestra del archivo original (primeras 5 filas)</strong></summary>
                {version.profile.sheets.map(sheet => (
                  <div key={sheet.name} className="table-scroll" style={{ marginTop: '12px' }}>
                    <h4>Hoja: {sheet.name} ({sheet.headers.length} columnas detectadas)</h4>
                    <table>
                      <thead>
                        <tr>
                          {sheet.headers.map(h => <th key={h}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.sample.map((row, i) => (
                          <tr key={i}>
                            {row.map((val, j) => <td key={j}>{val ?? '—'}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </details>
            )}

            {/* Acciones principales de la versión */}
            <div className="data-actions" style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              {version.mapping && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      setPreview(await api(`/uploads/${version.id}/preview`, dataPreviewSchema));
                    });
                  }}
                >
                  Ver valores normalizados
                </button>
              )}
              {manage && (version.publishedAt || version.state === 'ready') && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => openAiModal(version)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  title={`Crear una nueva versión con columna de IA a partir de v${version.number}`}
                >
                  <span>✨</span>
                  <span>Columna con IA</span>
                </button>
              )}
              {manage && version.state === 'ready' && !version.publishedAt && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      const pub = await api(`/uploads/${version.id}/publish`, versionSchema, {
                        method: 'POST',
                        headers: { 'Idempotency-Key': crypto.randomUUID() },
                      });
                      setVersion(pub);
                      await refresh();
                      setNotice(`Versión v${version.number} publicada como vigente. Ya puedes definir KPIs y dashboards sobre estos datos.`);
                    });
                  }}
                >
                  Publicar versión v{version.number}
                </button>
              )}
              {manage && version.publishedAt && activeDataset?.currentVersionId !== version.id && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await api(`/uploads/${version.id}/restore`, versionSchema, {
                        method: 'POST',
                        headers: { 'Idempotency-Key': crypto.randomUUID() },
                      });
                      await refresh();
                      setNotice(`Versión v${version.number} restaurada como versión vigente.`);
                    });
                  }}
                >
                  Restaurar v{version.number} como vigente
                </button>
              )}
              {manage && !version.publishedAt && version.state !== 'cancelled' && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      const cancelled = await api(`/uploads/${version.id}/cancel`, versionSchema, { method: 'POST' });
                      setVersion(cancelled);
                      setNotice(`Versión v${version.number} cancelada.`);
                    });
                  }}
                >
                  Cancelar versión
                </button>
              )}
            </div>

            {/* Previsualización normalizada */}
            {preview && (
              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <h3>Valores normalizados · Primeras 50 filas publicables</h3>
                <p className="secondary">Estos son los datos limpios que se almacenan en el dataset con sus tipos y formatos finales:</p>
                <div className="table-scroll" style={{ maxHeight: '400px' }}>
                  <table>
                    <thead>
                      <tr>
                        {preview.fields.map(f => (
                          <th key={f.target}>
                            {f.target} <span style={{ fontSize: '10px', color: 'var(--secondary)' }}>({f.type})</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i}>
                          {preview.fields.map(f => (
                            <td key={f.target}>
                              {row[f.target] === null ? <span style={{ color: 'var(--secondary)' }}>—</span> : String(row[f.target] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
