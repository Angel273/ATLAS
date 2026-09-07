/**
 * @file formula-builder-panel.tsx
 * @description Panel lateral para la construcción, validación y edición visual de fórmulas de KPIs.
 * Permite seleccionar datasets, insertar funciones SQL/DSL parametrizadas, configurar metas operacionales
 * (target, advertencia, crítico) y especificar dependencias entre métricas.
 */

'use client';
import { useState, useEffect, type FormEvent } from 'react';
import { Activity, Check, AlertTriangle, AlertCircle, X, Sparkles, Plus, Code2 } from 'lucide-react';
import type { DatasetVersion, Kpi, TargetDirection } from '@atlas/contracts';
import type { KpiNodeData } from '../types';

interface FormulaBuilderPanelProps {
  isOpen: boolean;
  onClose: () => void;
  kpiData: KpiNodeData | null;
  sources: Array<{ id: string; name: string; slug: string; version: DatasetVersion }>;
  allKpis: Kpi[];
  onSaveKpi: (payload: {
    name: string;
    slug: string;
    description: string;
    datasetVersionId: string;
    relatedDatasetVersionIds: string[];
    formula: string;
    unit: 'number' | 'percent' | 'seconds' | 'text';
    precision: number;
    dimensions: string[];
    targetDirection: TargetDirection;
    targets: { target?: number; warningThreshold?: number; criticalThreshold?: number };
    dependencies: string[];
  }) => Promise<void>;
  canManage: boolean;
}

/**
 * Componente de panel lateral que gestiona el formulario de edición y validación sintáctica de fórmulas de KPIs.
 */
export function FormulaBuilderPanel({
  isOpen,
  onClose,
  kpiData,
  sources,
  allKpis,
  onSaveKpi,
  canManage,
}: FormulaBuilderPanelProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [sourceVersionId, setSourceVersionId] = useState('');
  const [relatedVersionIds, setRelatedVersionIds] = useState<string[]>([]);
  const [formula, setFormula] = useState('');
  const [unit, setUnit] = useState<'number' | 'percent' | 'seconds' | 'text'>('number');
  const [precision, setPrecision] = useState(2);
  const [targetDirection, setTargetDirection] = useState<TargetDirection>('higher_is_better');
  const [targetVal, setTargetVal] = useState('');
  const [warningVal, setWarningVal] = useState('');
  const [criticalVal, setCriticalVal] = useState('');
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [dependencies, setDependencies] = useState<string[]>([]);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formulaWarning, setFormulaWarning] = useState('');

  useEffect(() => {
    if (kpiData) {
      setName(kpiData.name || '');
      setSlug(kpiData.slug || '');
      setDescription(kpiData.description || '');
      setSourceVersionId(kpiData.datasetVersionId || (sources[0]?.version.id ?? ''));
      setRelatedVersionIds(kpiData.relatedDatasetVersionIds || []);
      setFormula(kpiData.formula || '');
      setUnit(kpiData.unit || 'number');
      setPrecision(kpiData.precision ?? 2);
      setTargetDirection(kpiData.targetDirection || 'higher_is_better');
      setTargetVal(kpiData.targets?.target !== undefined ? String(kpiData.targets.target) : '');
      setWarningVal(kpiData.targets?.warningThreshold !== undefined ? String(kpiData.targets.warningThreshold) : '');
      setCriticalVal(kpiData.targets?.criticalThreshold !== undefined ? String(kpiData.targets.criticalThreshold) : '');
      setDimensions(kpiData.dimensions || []);
      setDependencies(kpiData.dependencies || []);
      setError('');
    } else {
      // Defaults for a new KPI
      setName('');
      setSlug('');
      setDescription('');
      setSourceVersionId(sources[0]?.version.id ?? '');
      setRelatedVersionIds([]);
      setFormula('COUNT(id)');
      setUnit('number');
      setPrecision(2);
      setTargetDirection('higher_is_better');
      setTargetVal('');
      setWarningVal('');
      setCriticalVal('');
      setDimensions([]);
      setDependencies([]);
      setError('');
    }
  }, [kpiData, sources]);

  // Real-time formula syntax & zero-division checks
  useEffect(() => {
    if (!formula.trim()) {
      setFormulaWarning('');
      return;
    }

    // Check unmatched parentheses
    let openCount = 0;
    for (const char of formula) {
      if (char === '(') openCount++;
      if (char === ')') openCount--;
      if (openCount < 0) break;
    }
    if (openCount !== 0) {
      setFormulaWarning('Paréntesis desbalanceados en la fórmula.');
      return;
    }

    // Check division without NULLIF
    if (formula.includes('/') && !formula.toUpperCase().includes('NULLIF')) {
      setFormulaWarning('Consejo: Para evitar división por cero en SQL, usa NULLIF(divisor, 0).');
      return;
    }

    setFormulaWarning('');
  }, [formula]);

  if (!isOpen) return null;

  const selectedSource = sources.find(s => s.version.id === sourceVersionId);
  const availableFields = selectedSource?.version.mapping?.fields || [];

  function handleInsertFunction(fn: string) {
    setFormula(prev => prev ? `${prev} ${fn}` : fn);
  }

  function handleInsertField(fieldName: string) {
    setFormula(prev => prev ? `${prev} ${fieldName}` : fieldName);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('El nombre del KPI es obligatorio.');
      return;
    }
    const cleanSlug = (slug.trim() || name.toLowerCase().replace(/[^a-z0-9_]/g, '_')).slice(0, 63);
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(cleanSlug)) {
      setError('El slug debe iniciar con letra minúscula y contener solo minúsculas, números o guiones bajos.');
      return;
    }
    if (!sourceVersionId) {
      setError('Debes seleccionar el dataset versión principal.');
      return;
    }
    if (!formula.trim()) {
      setError('La fórmula es requerida.');
      return;
    }

    const t = targetVal ? Number(targetVal) : undefined;
    const w = warningVal ? Number(warningVal) : undefined;
    const c = criticalVal ? Number(criticalVal) : undefined;

    setBusy(true);
    setError('');
    try {
      await onSaveKpi({
        name: name.trim(),
        slug: cleanSlug,
        description: description.trim(),
        datasetVersionId: sourceVersionId,
        relatedDatasetVersionIds: relatedVersionIds,
        formula: formula.trim(),
        unit,
        precision,
        dimensions,
        targetDirection,
        targets: (() => {
          const res: { target?: number; warningThreshold?: number; criticalThreshold?: number } = {};
          if (t !== undefined && !Number.isNaN(t)) res.target = t;
          if (w !== undefined && !Number.isNaN(w)) res.warningThreshold = w;
          if (c !== undefined && !Number.isNaN(c)) res.criticalThreshold = c;
          return res;
        })(),
        dependencies,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el KPI.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 76,
        right: 0,
        bottom: 0,
        width: 460,
        maxWidth: '100vw',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border-strong)',
        boxShadow: '-8px 0 24px rgba(29, 29, 27, 0.12)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--sans)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 4,
              background: '#2F6FED',
              color: '#FFFFFF',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Activity size={16} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {kpiData ? `Editar: ${kpiData.name}` : 'Nuevo KPI Gobernado'}
            </h3>
            <div style={{ fontSize: 11, color: 'var(--secondary)' }}>
              Inspector de Métricas y Constructor de Fórmulas DSL
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--secondary)', cursor: 'pointer', padding: 4 }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Form Body */}
      <form
        onSubmit={handleSubmit}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 4,
              background: '#FDF2F2',
              border: '1px solid #E8B4B4',
              color: '#9A433D',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Name & Slug */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Nombre del KPI *
            </label>
            <input
              type="text"
              value={name}
              disabled={!canManage}
              onChange={e => {
                setName(e.target.value);
                if (!kpiData && !slug) {
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60));
                }
              }}
              placeholder="ej. SLA 20s"
              style={{ width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Slug *
            </label>
            <input
              type="text"
              value={slug}
              disabled={!canManage}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="sla_20s"
              style={{ width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--border)', background: 'var(--canvas)', fontFamily: 'ui-monospace, monospace' }}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
            Descripción
          </label>
          <input
            type="text"
            value={description}
            disabled={!canManage}
            onChange={e => setDescription(e.target.value)}
            placeholder="Porcentaje de llamadas atendidas en 20 segundos o menos"
            style={{ width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
          />
        </div>

        {/* Dataset source */}
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
            Dataset Base *
          </label>
          <select
            value={sourceVersionId}
            disabled={!canManage}
            onChange={e => {
              setSourceVersionId(e.target.value);
              setDimensions([]);
            }}
            style={{ width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
          >
            {sources.map(s => (
              <option key={s.version.id} value={s.version.id}>
                {s.name} ({s.slug} - v{s.version.number})
              </option>
            ))}
          </select>
        </div>

        {/* Formula Builder Box */}
        <div
          style={{
            borderRadius: 6,
            border: '1px solid var(--border-strong)',
            background: 'var(--canvas)',
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Code2 size={13} /> Expresión de Fórmula DSL *
            </span>
          </div>

          {/* Quick function insert badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {['SUM()', 'COUNT()', 'AVG()', 'MIN()', 'MAX()', 'IF(cond, 1, 0)', 'NULLIF(x, 0)'].map(fn => (
              <button
                key={fn}
                type="button"
                onClick={() => handleInsertFunction(fn)}
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  fontFamily: 'ui-monospace, monospace',
                  color: 'var(--accent)',
                }}
              >
                +{fn}
              </button>
            ))}
          </div>

          <textarea
            value={formula}
            disabled={!canManage}
            onChange={e => setFormula(e.target.value)}
            rows={3}
            placeholder="SUM(IF(wait_time <= 20, 1, 0)) / NULLIF(COUNT(call_id), 0) * 100"
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              lineHeight: 1.4,
              resize: 'vertical',
            }}
          />

          {/* Columns quick insert */}
          {availableFields.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--secondary)', marginBottom: 4 }}>
                Insertar campos de {selectedSource?.slug}:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 60, overflowY: 'auto' }}>
                {availableFields.map(f => (
                  <button
                    key={f.target}
                    type="button"
                    onClick={() => handleInsertField(f.target)}
                    style={{
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: 'rgba(54, 92, 74, 0.08)',
                      border: '1px solid rgba(54, 92, 74, 0.2)',
                      cursor: 'pointer',
                      fontFamily: 'ui-monospace, monospace',
                      color: 'var(--accent)',
                    }}
                  >
                    {f.target}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Formula Warning / Suggestion */}
          {formulaWarning && (
            <div
              style={{
                marginTop: 8,
                padding: '6px 10px',
                borderRadius: 4,
                background: '#FEF9EF',
                border: '1px solid #F0D499',
                color: '#8A5D19',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              <span>{formulaWarning}</span>
            </div>
          )}
        </div>

        {/* Unit & Precision */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Unidad
            </label>
            <select
              value={unit}
              disabled={!canManage}
              onChange={e => setUnit(e.target.value as unknown as typeof unit)}
              style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
            >
              <option value="number">Número (#)</option>
              <option value="percent">Porcentaje (%)</option>
              <option value="seconds">Segundos (s)</option>
              <option value="text">Texto / Categoría (txt)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Decimales (Precisión)
            </label>
            <input
              type="number"
              min={0}
              max={6}
              value={precision}
              disabled={!canManage}
              onChange={e => setPrecision(Number(e.target.value))}
              style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
            />
          </div>
        </div>

        {/* Target direction & Traffic Light */}
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
            Dirección del Objetivo
          </label>
          <select
            value={targetDirection}
            disabled={!canManage}
            onChange={e => setTargetDirection(e.target.value as TargetDirection)}
            style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
          >
            <option value="higher_is_better">Mayor es mejor (ej. Ventas, CSAT, SLA)</option>
            <option value="lower_is_better">Menor es mejor (ej. TMO, Cancelaciones)</option>
            <option value="target_match">Coincidencia exacta con meta</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--positive)', marginBottom: 2 }}>
              Meta (Verde)
            </label>
            <input
              type="number"
              step="any"
              value={targetVal}
              disabled={!canManage}
              onChange={e => setTargetVal(e.target.value)}
              placeholder="80"
              style={{ width: '100%', height: 32, padding: '0 6px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--warning)', marginBottom: 2 }}>
              Alerta (Amarillo)
            </label>
            <input
              type="number"
              step="any"
              value={warningVal}
              disabled={!canManage}
              onChange={e => setWarningVal(e.target.value)}
              placeholder="70"
              style={{ width: '100%', height: 32, padding: '0 6px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--negative)', marginBottom: 2 }}>
              Crítico (Rojo)
            </label>
            <input
              type="number"
              step="any"
              value={criticalVal}
              disabled={!canManage}
              onChange={e => setCriticalVal(e.target.value)}
              placeholder="60"
              style={{ width: '100%', height: 32, padding: '0 6px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
            />
          </div>
        </div>

        {/* Dimensions Selection */}
        {availableFields.length > 0 && (
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Dimensiones de Agrupación Permitidas
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {availableFields.map(f => {
                const isSelected = dimensions.includes(f.target);
                return (
                  <button
                    key={f.target}
                    type="button"
                    disabled={!canManage}
                    onClick={() => {
                      setDimensions(prev =>
                        isSelected ? prev.filter(d => d !== f.target) : [...prev, f.target]
                      );
                    }}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 3,
                      border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: isSelected ? 'var(--accent)' : 'var(--surface)',
                      color: isSelected ? 'var(--on-accent)' : 'var(--ink)',
                      cursor: 'pointer',
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    {f.target}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Dependencies */}
        {allKpis.length > 0 && (
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Dependencias de otros KPIs
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allKpis.filter(k => k.slug !== slug).map(k => {
                const isDep = dependencies.includes(k.slug);
                return (
                  <button
                    key={k.slug}
                    type="button"
                    disabled={!canManage}
                    onClick={() => {
                      setDependencies(prev =>
                        isDep ? prev.filter(d => d !== k.slug) : [...prev, k.slug]
                      );
                    }}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 3,
                      border: isDep ? '1px solid #2F6FED' : '1px solid var(--border)',
                      background: isDep ? '#2F6FED' : 'var(--surface)',
                      color: isDep ? '#FFFFFF' : 'var(--ink)',
                      cursor: 'pointer',
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    {k.slug}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 'auto', paddingTop: 16 }}>
          <button type="button" onClick={onClose} className="button" style={{ height: 36 }}>
            Cancelar
          </button>
          {canManage && (
            <button
              type="submit"
              disabled={busy}
              className="button primary"
              style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Check size={14} />
              {busy ? 'Publicando...' : 'Publicar KPI'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
