'use client';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import { z } from 'zod';
import {
  sessionSchema,
  kpiListSchema,
  kpiSchema,
  kpiLifecycleResultSchema,
  datasetListSchema,
  versionListSchema,
  queryResultSchema,
  semanticRelationshipListSchema,
  semanticRelationshipSchema,
  type Session,
  type Kpi,
  type DatasetVersion,
  type SemanticRelationship,
} from '@atlas/contracts';
import { api } from '../../../lib/api';
import { Brand } from '../../../components/workspace';
import { AppHeader } from '../../../components/app-header';

export default function KpisPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [sources, setSources] = useState<{ id: string; name: string; slug: string; version: DatasetVersion }[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [relatedVersionIds, setRelatedVersionIds] = useState<string[]>([]);

  // Editing state for KPI versioning
  const [editingKpi, setEditingKpi] = useState<Kpi | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFormula, setFormFormula] = useState('');
  const [formUnit, setFormUnit] = useState<'number' | 'percent' | 'seconds'>('number');
  const [formPrecision, setFormPrecision] = useState(2);
  const [formTargetDirection, setFormTargetDirection] = useState<'higher_is_better' | 'lower_is_better' | 'target_match'>('higher_is_better');
  const [formTarget, setFormTarget] = useState('');
  const [formWarningThreshold, setFormWarningThreshold] = useState('');
  const [formCriticalThreshold, setFormCriticalThreshold] = useState('');
  const [formDimensions, setFormDimensions] = useState<string[]>([]);
  const [formDependencies, setFormDependencies] = useState('');
  const formSectionRef = useRef<HTMLElement>(null);

  // Relationships state
  const [relationships, setRelationships] = useState<SemanticRelationship[]>([]);
  const [relFromDs, setRelFromDs] = useState('');
  const [relToDs, setRelToDs] = useState('');

  // Query & inspect state
  const [selected, setSelected] = useState<Kpi | null>(null);
  const [result, setResult] = useState<z.infer<typeof queryResultSchema> | null>(null);
  const [dimension, setDimension] = useState('');
  const [filterField, setFilterField] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [dateField, setDateField] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [showDeprecated, setShowDeprecated] = useState(false);
  const [kpiToDelete, setKpiToDelete] = useState<Kpi | null>(null);

  const manage = session?.capabilities.includes('semantic.manage');
  const canPublish = session?.capabilities.includes('semantic.publish');
  const mainSource = sources.find(s => s.version.id === sourceId);

  async function refresh(includeDep = showDeprecated) {
    setKpis((await api(`/kpis?includeDeprecated=${includeDep}`, kpiListSchema)).items);
    if (session?.capabilities.includes('semantic.read')) {
      try {
        setRelationships((await api('/semantic/relationships', semanticRelationshipListSchema)).items);
      } catch {
        // Semantic endpoint might be loading
      }
    }
  }

  useEffect(() => {
    void refresh(showDeprecated);
  }, [showDeprecated]);

  async function handleDeleteOrDeprecate() {
    if (!kpiToDelete) return;
    await run(async () => {
      const res = await api(`/kpis/${kpiToDelete.id}`, kpiLifecycleResultSchema, {
        method: 'DELETE',
      });
      if (res.action === 'deleted') {
        setNotice(`El borrador del KPI '${kpiToDelete.name}' ha sido eliminado definitivamente.`);
        if (selected?.id === kpiToDelete.id) {
          setSelected(null);
          setResult(null);
        }
      } else {
        setNotice(`El KPI '${kpiToDelete.name}' ha sido deprecado.`);
      }
      setKpiToDelete(null);
      await refresh();
    });
  }

  function handleEditKpi(kpi: Kpi) {
    setEditingKpi(kpi);
    setFormName(kpi.name);
    setFormSlug(kpi.slug);
    setFormDescription(kpi.description || '');
    setSourceId(kpi.datasetVersionId);
    setRelatedVersionIds(kpi.relatedDatasetVersionIds || []);
    setFormFormula(kpi.formula);
    setFormUnit(kpi.unit);
    setFormPrecision(kpi.precision);
    setFormTargetDirection(kpi.targetDirection || 'higher_is_better');
    setFormTarget(kpi.targets?.target !== undefined ? String(kpi.targets.target) : '');
    setFormWarningThreshold(kpi.targets?.warningThreshold !== undefined ? String(kpi.targets.warningThreshold) : '');
    setFormCriticalThreshold(kpi.targets?.criticalThreshold !== undefined ? String(kpi.targets.criticalThreshold) : '');
    setFormDimensions(kpi.dimensions || []);
    setFormDependencies((kpi.dependencies || []).join(', '));
    setError('');
    setNotice('');
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleCancelEdit() {
    setEditingKpi(null);
    setFormName('');
    setFormSlug('');
    setFormDescription('');
    setFormFormula('');
    setFormUnit('number');
    setFormPrecision(2);
    setFormTargetDirection('higher_is_better');
    setFormTarget('');
    setFormWarningThreshold('');
    setFormCriticalThreshold('');
    setFormDimensions([]);
    setFormDependencies('');
  }

  useEffect(() => {
    void (async () => {
      try {
        const user = await api('/auth/session', sessionSchema);
        setSession(user);
        setKpis((await api('/kpis', kpiListSchema)).items);

        if (user.capabilities.includes('semantic.read')) {
          try {
            setRelationships((await api('/semantic/relationships', semanticRelationshipListSchema)).items);
          } catch {
            // Ignored on initial session load
          }
        }

        if (user.capabilities.includes('semantic.manage')) {
          const datasets = await api('/datasets', datasetListSchema);
          const items = await Promise.all(
            datasets.items.map(async dataset => ({
              id: dataset.id,
              name: dataset.name,
              slug: dataset.slug,
              versions: (await api(`/datasets/${dataset.id}/versions`, versionListSchema)).items,
            }))
          );
          setSources(
            items.flatMap(item =>
              item.versions
                .filter(version => version.publishedAt)
                .map(version => ({ id: item.id, name: item.name, slug: item.slug, version }))
            )
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo cargar.');
      }
    })();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  }

  async function createRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('/semantic/relationships', semanticRelationshipSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          fromDatasetId: form.get('fromDatasetId'),
          fromField: form.get('fromField'),
          toDatasetId: form.get('toDatasetId'),
          toField: form.get('toField'),
          cardinality: form.get('cardinality'),
          joinType: form.get('joinType') ?? 'left',
          isPreferred: form.get('isPreferred') === 'on',
        }),
      });
      setNotice('Relación semántica publicada y disponible para el compilador de JOINs.');
      await refresh();
    });
  }

  async function createKpi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetVal = formTarget ? Number(formTarget) : undefined;
    const warnVal = formWarningThreshold ? Number(formWarningThreshold) : undefined;
    const critVal = formCriticalThreshold ? Number(formCriticalThreshold) : undefined;

    const targets: Record<string, number> = {};
    if (targetVal !== undefined && !Number.isNaN(targetVal)) targets.target = targetVal;
    if (warnVal !== undefined && !Number.isNaN(warnVal)) targets.warningThreshold = warnVal;
    if (critVal !== undefined && !Number.isNaN(critVal)) targets.criticalThreshold = critVal;

    await run(async () => {
      const kpi = await api('/kpis', kpiSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          name: formName,
          slug: formSlug,
          description: formDescription,
          datasetVersionId: sourceId,
          relatedDatasetVersionIds: relatedVersionIds,
          formula: formFormula,
          unit: formUnit,
          precision: formPrecision,
          dimensions: formDimensions,
          targetDirection: formTargetDirection,
          targets,
          dependencies: formDependencies ? formDependencies.split(',').map(s => s.trim()).filter(Boolean) : [],
        }),
      });
      setSelected(kpi);
      setDimension('');
      setFilterField('');
      setResult(null);
      const wasEditing = editingKpi;
      handleCancelEdit();
      await refresh();
      setNotice(
        wasEditing
          ? `Nueva versión v${kpi.number} de "${kpi.name}" guardada exitosamente. La versión v${wasEditing.number} se mantiene inmutable para trazabilidad histórica.`
          : 'Definición validada y guardada. Calcula una vista previa antes de publicarla.'
      );
    });
  }

  const fromSourceItem = sources.find(s => s.id === relFromDs);
  const toSourceItem = sources.find(s => s.id === relToDs);

  const availableDatasetsForKpi = [
    ...(mainSource ? [mainSource] : []),
    ...sources.filter(s => relatedVersionIds.includes(s.version.id)),
  ];

  return (
    <>
      <AppHeader session={session} />

      <main id="main" className="workspace data-workspace">
        <div className="breadcrumb">Espacio de trabajo / Capa Semántica & KPIs</div>
        <div className="title-row">
          <div>
            <span className="eyebrow secondary">Modelo Semántico y Métricas</span>
            <h1>Motor de KPI y Relaciones</h1>
            <p>Define uniones entre datasets, gobierna KPIs multi-tabla y evalúa metas operacionales.</p>
          </div>
        </div>

        {error && <p role="alert" className="form-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}

        {/* SECTION 1: Semantic Relationships (Phase 2 Multi-table) */}
        {manage && (
          <section className="panel data-card">
            <h2>Relaciones semánticas entre datasets</h2>
            <p className="secondary">
              Conecta tablas publicadas para habilitar consultas y KPIs multi-tabla sin productos cartesianos.
            </p>
            {sources.length < 2 ? (
              <p className="secondary">Se requieren al menos 2 datasets publicados para definir relaciones.</p>
            ) : (
              <form onSubmit={event => { void createRelationship(event); }}>
                <div className="data-grid">
                  <label className="field">
                    Dataset Origen (de)
                    <select
                      name="fromDatasetId"
                      value={relFromDs}
                      required
                      onChange={e => setRelFromDs(e.target.value)}
                    >
                      <option value="">Selecciona dataset origen</option>
                      {Array.from(new Set(sources.map(s => s.id))).map(id => {
                        const s = sources.find(item => item.id === id)!;
                        return <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>;
                      })}
                    </select>
                  </label>

                  <label className="field">
                    Campo Clave Origen
                    <select name="fromField" required disabled={!fromSourceItem}>
                      <option value="">Selecciona campo origen</option>
                      {fromSourceItem?.version.mapping?.fields.map(f => (
                        <option key={f.target} value={f.target}>{f.target} ({f.type})</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    Dataset Destino (a)
                    <select
                      name="toDatasetId"
                      value={relToDs}
                      required
                      onChange={e => setRelToDs(e.target.value)}
                    >
                      <option value="">Selecciona dataset destino</option>
                      {Array.from(new Set(sources.map(s => s.id)))
                        .filter(id => id !== relFromDs)
                        .map(id => {
                          const s = sources.find(item => item.id === id)!;
                          return <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>;
                        })}
                    </select>
                  </label>

                  <label className="field">
                    Campo Clave Destino
                    <select name="toField" required disabled={!toSourceItem}>
                      <option value="">Selecciona campo destino</option>
                      {toSourceItem?.version.mapping?.fields.map(f => (
                        <option key={f.target} value={f.target}>{f.target} ({f.type})</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    Cardinalidad
                    <select name="cardinality" defaultValue="many_to_one">
                      <option value="many_to_one">Muchos a Uno (N:1)</option>
                      <option value="one_to_one">Uno a Uno (1:1)</option>
                      <option value="one_to_many">Uno a Muchos (1:N)</option>
                    </select>
                  </label>

                  <label className="field">
                    Tipo de Join
                    <select name="joinType" defaultValue="left">
                      <option value="left">LEFT JOIN (Conserva filas origen)</option>
                      <option value="inner">INNER JOIN (Solo coincidencias)</option>
                    </select>
                  </label>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <input type="checkbox" name="isPreferred" />
                    <span>Marcar como <strong>Ruta preferida</strong> para desambiguar uniones alternativas</span>
                  </label>
                </div>

                <button className="button primary" style={{ marginTop: '14px' }} disabled={busy}>
                  Publicar relación semántica
                </button>
              </form>
            )}

            {relationships.length > 0 && (
              <div className="table-scroll" style={{ marginTop: '20px' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Origen</th>
                      <th>Campo</th>
                      <th>Destino</th>
                      <th>Campo</th>
                      <th>Cardinalidad</th>
                      <th>Join</th>
                      <th>Preferida</th>
                      <th>Publicada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relationships.map(r => {
                      const from = sources.find(s => s.id === r.fromDatasetId);
                      const to = sources.find(s => s.id === r.toDatasetId);
                      return (
                        <tr key={r.id}>
                          <td>{from?.name ?? r.fromDatasetId}</td>
                          <td><code>{r.fromField}</code></td>
                          <td>{to?.name ?? r.toDatasetId}</td>
                          <td><code>{r.toField}</code></td>
                          <td>{r.cardinality}</td>
                          <td>{r.joinType.toUpperCase()}</td>
                          <td>{r.isPreferred ? '★ Sí' : 'No'}</td>
                          <td>{new Date(r.publishedAt).toLocaleDateString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* SECTION 2: Define KPI (Phase 2 targets and multi-table) */}
        {manage && (
          <section className="panel data-card" ref={formSectionRef}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2>{editingKpi ? `Modificar KPI: ${editingKpi.name} (v${editingKpi.number})` : 'Definir una versión de KPI'}</h2>
                <p className="secondary">
                  {editingKpi
                    ? `Configura la siguiente versión de ${editingKpi.name}. Al guardar se incrementará a v${editingKpi.number + 1}.`
                    : 'Crea métricas operacionales gobernadas con fórmulas auditables, metas y umbrales.'}
                </p>
              </div>
              {editingKpi && (
                <button
                  type="button"
                  className="button"
                  onClick={handleCancelEdit}
                >
                  ✕ Cancelar edición
                </button>
              )}
            </div>

            {editingKpi && (
              <div
                style={{
                  padding: '12px 16px',
                  margin: '16px 0',
                  background: 'var(--surface-muted)',
                  borderLeft: '3px solid var(--accent)',
                  borderRadius: '3px',
                }}
              >
                <strong style={{ color: 'var(--accent)', display: 'block', marginBottom: '4px' }}>
                  Modo Edición / Versionado Activo: {editingKpi.name} (<code>{editingKpi.slug}</code>)
                </strong>
                <p className="secondary" style={{ margin: 0, fontSize: '13px' }}>
                  Principio de inmutabilidad (ATLAS): Las versiones ya creadas no se sobreescriben. Al guardar tus cambios se creará la versión <strong>v{editingKpi.number + 1}</strong>, asegurando que dashboards históricos que dependan de <strong>v{editingKpi.number}</strong> permanezcan 100% reproducibles.
                </p>
              </div>
            )}

            {sources.length === 0 ? (
              <p>Publica primero un dataset desde <a href="/app/datasets">Datasets</a>.</p>
            ) : (
              <form onSubmit={event => { void createKpi(event); }}>
                <div className="data-grid">
                  <label className="field">
                    Nombre
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={120}
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      placeholder="ej. CSAT Promedio"
                    />
                  </label>
                  <label className="field">
                    Identificador (Slug)
                    <input
                      name="slug"
                      required
                      pattern="[a-z][a-z0-9_]{1,62}"
                      placeholder="csat_promedio"
                      value={formSlug}
                      onChange={e => setFormSlug(e.target.value)}
                      readOnly={Boolean(editingKpi)}
                      style={editingKpi ? { backgroundColor: 'var(--surface-muted)', cursor: 'not-allowed' } : undefined}
                    />
                    {editingKpi && (
                      <span className="secondary" style={{ fontSize: '11px', marginTop: '2px', display: 'block' }}>
                        Identificador fijo para mantener el linaje y versionado del KPI.
                      </span>
                    )}
                  </label>
                  <label className="field">
                    Dataset Principal
                    <select
                      value={sourceId}
                      required
                      onChange={e => {
                        setSourceId(e.target.value);
                        setRelatedVersionIds([]);
                      }}
                    >
                      <option value="">Selecciona dataset principal</option>
                      {sources.map(item => (
                        <option key={item.version.id} value={item.version.id}>
                          {item.name} · v{item.version.number} ({item.slug})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Unidad
                    <select
                      name="unit"
                      value={formUnit}
                      onChange={e => setFormUnit(e.target.value as 'number' | 'percent' | 'seconds')}
                    >
                      <option value="number">Número</option>
                      <option value="percent">Porcentaje (escala 0–100)</option>
                      <option value="seconds">Segundos</option>
                    </select>
                  </label>
                  <label className="field">
                    Decimales
                    <input
                      name="precision"
                      type="number"
                      min={0}
                      max={12}
                      value={formPrecision}
                      onChange={e => setFormPrecision(Number(e.target.value))}
                      required
                    />
                  </label>
                  <label className="field">
                    Dirección de mejora
                    <select
                      name="targetDirection"
                      value={formTargetDirection}
                      onChange={e => setFormTargetDirection(e.target.value as 'higher_is_better' | 'lower_is_better' | 'target_match')}
                    >
                      <option value="higher_is_better">Mayor es mejor (ej. Calidad, Ventas)</option>
                      <option value="lower_is_better">Menor es mejor (ej. AHT, Errores)</option>
                      <option value="target_match">Cercano a la meta (ej. Adherencia)</option>
                    </select>
                  </label>
                </div>

                {/* Targets & Thresholds */}
                <div className="data-grid" style={{ marginTop: '12px' }}>
                  <label className="field">
                    Meta / Objetivo operacional
                    <input
                      name="target"
                      type="number"
                      step="any"
                      placeholder="ej. 85.0"
                      value={formTarget}
                      onChange={e => setFormTarget(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Umbral de Advertencia
                    <input
                      name="warningThreshold"
                      type="number"
                      step="any"
                      placeholder="ej. 75.0"
                      value={formWarningThreshold}
                      onChange={e => setFormWarningThreshold(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Umbral Crítico
                    <input
                      name="criticalThreshold"
                      type="number"
                      step="any"
                      placeholder="ej. 60.0"
                      value={formCriticalThreshold}
                      onChange={e => setFormCriticalThreshold(e.target.value)}
                    />
                  </label>
                </div>

                {/* Related datasets multi-select */}
                {mainSource && sources.length > 1 && (
                  <fieldset style={{ marginTop: '14px' }}>
                    <legend>Datasets adicionales para la capa semántica (opcional)</legend>
                    <div className="data-grid">
                      {sources
                        .filter(s => s.version.id !== sourceId)
                        .map(s => (
                          <label key={s.version.id}>
                            <input
                              type="checkbox"
                              checked={relatedVersionIds.includes(s.version.id)}
                              onChange={e => {
                                if (e.target.checked) setRelatedVersionIds([...relatedVersionIds, s.version.id]);
                                else setRelatedVersionIds(relatedVersionIds.filter(id => id !== s.version.id));
                              }}
                            />{' '}
                            {s.name} · v{s.version.number} <code>({s.slug})</code>
                          </label>
                        ))}
                    </div>
                  </fieldset>
                )}

                <label className="field" style={{ marginTop: '12px' }}>
                  Descripción
                  <input
                    name="description"
                    maxLength={1000}
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                    placeholder="Descripción o propósito operativo de esta métrica"
                  />
                </label>

                <label className="field">
                  Fórmula
                  <textarea
                    name="formula"
                    required
                    maxLength={4000}
                    rows={3}
                    placeholder="SUM(calls.duracion) / COUNT(calls.id)"
                    value={formFormula}
                    onChange={e => setFormFormula(e.target.value)}
                  />
                </label>

                <p className="secondary">
                  Funciones admitidas: SUM, AVG, MIN, MAX, COUNT, COUNT_DISTINCT, IF, COALESCE, NULLIF, ROUND, ABS, DATE, DATE_DIFF y DATE_TRUNC.
                  Puedes calificar campos usando <code>tabla.campo</code> (ej. <code>calls.duracion</code>).
                </p>

                {availableDatasetsForKpi.length > 0 && (
                  <fieldset>
                    <legend>Campos y dimensiones permitidas para agrupar o filtrar</legend>
                    <div className="data-grid">
                      {availableDatasetsForKpi.flatMap(ds =>
                        ds.version.mapping?.fields.map(field => {
                          const dimValue = availableDatasetsForKpi.length > 1 ? `${ds.slug}.${field.target}` : field.target;
                          const isChecked = formDimensions.includes(dimValue) || formDimensions.includes(field.target);
                          return (
                            <label key={`${ds.slug}.${field.target}`}>
                              <input
                                type="checkbox"
                                name="dimensions"
                                value={dimValue}
                                checked={isChecked}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setFormDimensions(prev => [...prev.filter(d => d !== dimValue && d !== field.target), dimValue]);
                                  } else {
                                    setFormDimensions(prev => prev.filter(d => d !== dimValue && d !== field.target));
                                  }
                                }}
                              />{' '}
                              <strong>{ds.slug}.{field.target}</strong>{' '}
                              <span className="secondary">({field.type})</span>
                            </label>
                          );
                        }) ?? []
                      )}
                    </div>
                  </fieldset>
                )}

                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="button primary" disabled={busy}>
                    {busy
                      ? 'Guardando…'
                      : editingKpi
                      ? `Guardar versión v${editingKpi.number + 1}`
                      : 'Validar y guardar KPI'}
                  </button>
                  {editingKpi && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={handleCancelEdit}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            )}
          </section>
        )}

        {/* SECTION 3: Saved KPI Definitions */}
        <section className="panel data-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ margin: 0 }}>Definiciones guardadas</h2>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showDeprecated}
                onChange={e => setShowDeprecated(e.target.checked)}
              />
              <span>Mostrar KPIs deprecados</span>
            </label>
          </div>

          {!kpis.length ? (
            <p>No hay KPIs disponibles todavía.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>Versión</th>
                    <th>Estado</th>
                    <th>Meta</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.map(kpi => (
                    <tr key={kpi.id}>
                      <td>
                        <strong>{kpi.name}</strong> <code>({kpi.slug})</code>
                      </td>
                      <td>v{kpi.number}</td>
                      <td>
                        {kpi.deprecatedAt ? (
                          <span style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '12px' }}>
                            Deprecado
                          </span>
                        ) : kpi.publishedAt ? (
                          'Publicado'
                        ) : (
                          'Validado · vista previa'
                        )}
                      </td>
                      <td>
                        {kpi.targets.target !== undefined ? `${kpi.targets.target} ${kpi.unit}` : 'Sin meta'}
                      </td>
                      <td>
                        <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() => {
                              setSelected(kpi);
                              setDimension('');
                              setFilterField('');
                              setDateField('');
                              setDateFrom('');
                              setDateTo('');
                              setResult(null);
                            }}
                          >
                            Consultar v{kpi.number}
                          </button>
                          {manage && (
                            <>
                              <button
                                type="button"
                                className={`button ${editingKpi?.id === kpi.id ? 'primary' : ''}`}
                                disabled={busy}
                                onClick={() => handleEditKpi(kpi)}
                                title={`Editar y generar una nueva versión a partir de v${kpi.number}`}
                              >
                                {editingKpi?.id === kpi.id ? 'Editando' : 'Editar'}
                              </button>
                              {!kpi.deprecatedAt && (
                                <button
                                  type="button"
                                  className="button"
                                  disabled={busy}
                                  onClick={() => setKpiToDelete(kpi)}
                                  style={{ fontSize: '13px', color: '#b91c1c', borderColor: '#fca5a5' }}
                                  title={kpi.publishedAt ? 'Deprecar KPI gobernado' : 'Eliminar borrador de KPI'}
                                >
                                  {kpi.publishedAt ? 'Deprecar' : 'Eliminar'}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {kpiToDelete && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
            <div className="panel" style={{ background: 'var(--surface, #ffffff)', padding: '24px', borderRadius: '8px', maxWidth: '520px', width: '100%', border: '1px solid var(--border-strong)' }}>
              <h3 style={{ marginTop: 0, fontSize: '18px' }}>
                {kpiToDelete.publishedAt ? '¿Deprecar KPI gobernado?' : '¿Eliminar borrador definitivamente?'}
              </h3>
              <p style={{ color: 'var(--secondary)', lineHeight: 1.5, fontSize: '14px' }}>
                {kpiToDelete.publishedAt ? (
                  <>
                    El KPI <strong>{kpiToDelete.name} (v{kpiToDelete.number})</strong> está publicado. Para preservar el historial auditable y la coherencia de reportes previos de ATLAS, el KPI será <strong>deprecado</strong>. Se ocultará de la lista habitual y del Asistente IA, pero sus cálculos históricos se mantendrán.
                  </>
                ) : (
                  <>
                    El KPI <strong>{kpiToDelete.name} (v{kpiToDelete.number})</strong> es un borrador no publicado. Se <strong>eliminará permanentemente</strong> de la base de datos. Esta acción no se puede deshacer.
                  </>
                )}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setKpiToDelete(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button primary"
                  style={{ background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' }}
                  disabled={busy}
                  onClick={() => { void handleDeleteOrDeprecate(); }}
                >
                  {busy ? 'Procesando...' : kpiToDelete.publishedAt ? 'Confirmar y deprecar' : 'Confirmar y eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: Query & Inspection */}
        {selected && (
          <section className="panel data-card">
            <h2>{selected.name} · v{selected.number}</h2>
            <p><code>{selected.formula}</code></p>
            <p className="secondary">{selected.description}</p>

            <div className="data-grid">
              <label className="field">
                Agrupar por
                <select value={dimension} onChange={e => setDimension(e.target.value)}>
                  <option value="">Total general</option>
                  {selected.dimensions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                Filtro (igual a)
                <select value={filterField} onChange={e => setFilterField(e.target.value)}>
                  <option value="">Sin filtro</option>
                  {selected.dimensions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>

              {filterField && (
                <label className="field">
                  Valor del filtro
                  <input
                    value={filterValue}
                    onChange={e => setFilterValue(e.target.value)}
                    placeholder="Valor normalizado o fecha ISO"
                  />
                </label>
              )}
            </div>

            {/* Time Range Filter */}
            <div className="data-grid" style={{ marginTop: '12px' }}>
              <label className="field">
                Campo de Rango Temporal
                <select value={dateField} onChange={e => setDateField(e.target.value)}>
                  <option value="">Sin filtro de fecha</option>
                  {selected.dimensions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              {dateField && (
                <>
                  <label className="field">
                    Desde (Fecha)
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Hasta (Fecha)
                    <input
                      type="date"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>

            <div className="data-actions" style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    const timeRange = dateField && (dateFrom || dateTo)
                      ? { field: dateField, from: dateFrom || undefined, to: dateTo || undefined }
                      : undefined;

                    setResult(
                      await api('/queries', queryResultSchema, {
                        method: 'POST',
                        body: JSON.stringify({
                          kpiVersionId: selected.id,
                          dimensions: dimension ? [dimension] : [],
                          filters: filterField && filterValue ? [{ field: filterField, op: 'eq', value: filterValue }] : [],
                          timeRange,
                          limit: 100,
                        }),
                      })
                    );
                  });
                }}
              >
                {busy ? 'Calculando…' : 'Calcular KPI'}
              </button>

              {canPublish && !selected.publishedAt && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      setSelected(await api(`/kpis/${selected.id}/publish`, kpiSchema, { method: 'POST' }));
                      await refresh();
                      setNotice('KPI publicado exitosamente.');
                    });
                  }}
                >
                  Publicar KPI
                </button>
              )}

              {canPublish && selected.publishedAt && !selected.deprecatedAt && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      setSelected(await api(`/kpis/${selected.id}/deprecate`, kpiSchema, { method: 'POST' }));
                      await refresh();
                      setNotice('KPI marcado como deprecado.');
                    });
                  }}
                >
                  Deprecar KPI
                </button>
              )}
            </div>

            {result && (
              <div aria-live="polite" style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3>Resultado del cálculo</h3>
                  {result.targetEvaluation && result.targetEvaluation.target !== null && (
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '3px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor:
                          result.targetEvaluation.status === 'good'
                            ? 'var(--positive)'
                            : result.targetEvaluation.status === 'warning'
                            ? 'var(--warning)'
                            : result.targetEvaluation.status === 'critical'
                            ? 'var(--negative)'
                            : 'var(--surface-muted)',
                        color: 'var(--on-accent)',
                      }}
                    >
                      Meta: {result.targetEvaluation.target} (
                      {result.targetEvaluation.status === 'good'
                        ? 'En objetivo'
                        : result.targetEvaluation.status === 'warning'
                        ? 'Advertencia'
                        : result.targetEvaluation.status === 'critical'
                        ? 'Crítico'
                        : 'Neutral'}
                      )
                    </span>
                  )}
                </div>

                {result.rows.length === 0 ? (
                  <p>No hay datos para estos filtros.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {Object.keys(result.rows[0]!.dimensions).map(name => (
                            <th key={name}>{name}</th>
                          ))}
                          <th>
                            Valor · {selected.unit === 'percent' ? '%' : selected.unit === 'seconds' ? 'segundos' : 'número'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr key={i}>
                            {Object.entries(row.dimensions).map(([name, value]) => (
                              <td key={name}>{value ?? 'Sin valor'}</td>
                            ))}
                            <td>
                              <strong>{row.value ?? 'Sin resultado'}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {result.truncated && (
                  <p className="secondary">Se muestran los primeros 100 grupos. Acota los filtros para ver el resto.</p>
                )}
                {result.cacheHit && (
                  <p className="secondary">⚡ Resultado obtenido desde caché en memoria.</p>
                )}
                {result.warnings.map(warning => (
                  <p key={warning} role="alert">{warning}</p>
                ))}

                <details style={{ marginTop: '16px' }}>
                  <summary>Trazabilidad del cálculo y Capa Semántica</summary>
                  <dl>
                    <dt>Versión de datos raíz</dt>
                    <dd>{result.datasetVersionId}</dd>
                    <dt>Versión semántica</dt>
                    <dd>{result.modelVersionId}</dd>
                    <dt>Hash del archivo original</dt>
                    <dd><code>{result.sourceHash}</code></dd>
                    <dt>Huella de consulta (Query Hash)</dt>
                    <dd><code>{result.queryHash}</code></dd>
                    <dt>Rutas de uniones ejecutadas (JOINs)</dt>
                    <dd>
                      {result.joinPath.length > 0 ? (
                        <ul>
                          {result.joinPath.map((path, idx) => (
                            <li key={idx}><code>{path}</code></li>
                          ))}
                        </ul>
                      ) : (
                        <span>Consulta sobre dataset único (sin joins).</span>
                      )}
                    </dd>
                  </dl>
                </details>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
