'use client';
import { useState, useEffect } from 'react';
import {
  X,
  Palette,
  Target,
  Calculator,
  Sliders,
  Sparkles,
  Trash2,
  Check,
  Info,
} from 'lucide-react';
import type { WidgetDefinition, WidgetType, Kpi } from '@atlas/contracts';

interface WidgetConfigSidebarProps {
  widget: WidgetDefinition | null;
  kpis: Kpi[];
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updated: WidgetDefinition) => void;
  onDelete: (id: string) => void;
}

const PALETTE = [
  { name: 'Verde ATLAS', color: '#365C4A' },
  { name: 'Azul Petróleo', color: '#3E6177' },
  { name: 'Ámbar Cálido', color: '#A56A2A' },
  { name: 'Terracota', color: '#9A433D' },
  { name: 'Pizarra Grafito', color: '#4F4E4A' },
];

export function WidgetConfigSidebar({
  widget,
  kpis,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
}: WidgetConfigSidebarProps) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<WidgetType>('kpi_card');
  const [kpiVersionId, setKpiVersionId] = useState<string>('');
  const [dimension, setDimension] = useState<string>('');
  const [customDim, setCustomDim] = useState<string>('');
  const [colSpan, setColSpan] = useState<number>(6);
  const [textContent, setTextContent] = useState('');
  const [dateField, setDateField] = useState<string>('');

  // Config
  const [color, setColor] = useState('#365C4A');
  const [showTargetLine, setShowTargetLine] = useState(false);
  const [targetLineValue, setTargetLineValue] = useState<number | undefined>(undefined);
  const [targetLineLabel, setTargetLineLabel] = useState('');

  // Table computed column
  const [computedEnabled, setComputedEnabled] = useState(false);
  const [computedName, setComputedName] = useState('Desviación');
  const [calculationType, setCalculationType] = useState<'percent_of_target' | 'diff_from_target' | 'multiply_100' | 'custom'>('percent_of_target');
  const [customMultiplier, setCustomMultiplier] = useState<number>(1);

  // Table conditional formatting
  const [condEnabled, setCondEnabled] = useState(false);
  const [greenThreshold, setGreenThreshold] = useState<number | undefined>(undefined);
  const [redThreshold, setRedThreshold] = useState<number | undefined>(undefined);
  const [condMode, setCondMode] = useState<'badge' | 'background' | 'bar'>('badge');

  const selectedKpi = kpis.find(k => k.id === kpiVersionId);

  useEffect(() => {
    if (!widget) return;
    setTitle(widget.title);
    setType(widget.type);
    setKpiVersionId(widget.kpiVersionId || '');
    setDimension(widget.dimension || '');
    setCustomDim(widget.dimension || '');
    setColSpan(widget.grid.w || 6);
    setTextContent(widget.textContent || '');
    setDateField(widget.dateField || '');

    const cfg = widget.config || {};
    setColor(cfg.color || '#365C4A');
    setShowTargetLine(Boolean(cfg.showTargetLine));
    setTargetLineValue(cfg.targetLineValue);
    setTargetLineLabel(cfg.targetLineLabel || '');

    if (cfg.computedColumn) {
      setComputedEnabled(Boolean(cfg.computedColumn.enabled));
      setComputedName(cfg.computedColumn.name || 'Desviación');
      setCalculationType(cfg.computedColumn.calculationType || 'percent_of_target');
      setCustomMultiplier(cfg.computedColumn.customMultiplier ?? 1);
    } else {
      setComputedEnabled(false);
    }

    if (cfg.conditionalFormatting) {
      setCondEnabled(Boolean(cfg.conditionalFormatting.enabled));
      setGreenThreshold(cfg.conditionalFormatting.greenThreshold);
      setRedThreshold(cfg.conditionalFormatting.redThreshold);
      setCondMode(cfg.conditionalFormatting.mode || 'badge');
    } else {
      setCondEnabled(false);
    }
  }, [widget]);

  if (!isOpen || !widget) return null;

  function handleSave() {
    if (!widget) return;
    const finalDim = dimension === '__custom__' ? customDim : dimension;

    const updated: WidgetDefinition = {
      ...widget,
      title,
      type,
      ...(kpiVersionId ? { kpiVersionId } : { kpiVersionId: undefined }),
      ...(finalDim ? { dimension: finalDim } : { dimension: undefined }),
      ...(textContent ? { textContent } : { textContent: undefined }),
      ...(dateField.trim() ? { dateField: dateField.trim() } : { dateField: undefined }),
      grid: {
        ...widget.grid,
        w: colSpan,
      },
      config: {
        color,
        showTargetLine,
        targetLineValue: targetLineValue !== undefined && !Number.isNaN(targetLineValue) ? targetLineValue : undefined,
        targetLineLabel: targetLineLabel || undefined,
        computedColumn: computedEnabled ? {
          enabled: true,
          name: computedName,
          calculationType,
          ...(calculationType === 'custom' ? { customMultiplier } : {}),
        } : undefined,
        conditionalFormatting: condEnabled ? {
          enabled: true,
          greenThreshold: greenThreshold !== undefined && !Number.isNaN(greenThreshold) ? greenThreshold : undefined,
          redThreshold: redThreshold !== undefined && !Number.isNaN(redThreshold) ? redThreshold : undefined,
          mode: condMode,
        } : undefined,
      },
    };

    onUpdate(updated);
    onClose();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0, 0, 0, 0.3)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        style={{
          width: '100%',
          maxWidth: '460px',
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.12)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            background: 'var(--surface)',
            zIndex: 10,
          }}
        >
          <div>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Configurar Widget</h2>
            <p className="secondary" style={{ fontSize: '12px', margin: '2px 0 0' }}>
              Ajusta datos, métricas, colores y reglas visuales.
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar panel">
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Section: General */}
          <div>
            <span className="eyebrow secondary" style={{ fontSize: '11px' }}>General</span>
            <div className="field" style={{ marginTop: '8px' }}>
              <label htmlFor="sb-title">Título del Widget</label>
              <input
                id="sb-title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="field" style={{ marginTop: '12px' }}>
              <label htmlFor="sb-type">Tipo de Componente</label>
              <select
                id="sb-type"
                value={type}
                onChange={e => setType(e.target.value as WidgetType)}
              >
                <option value="kpi_card">Tarjeta KPI (Cifra destacada)</option>
                <option value="line_chart">Gráfico de Líneas (Tendencia temporal)</option>
                <option value="area_chart">Gráfico de Área (Acumulado)</option>
                <option value="bar_chart">Gráfico de Barras (Comparativa)</option>
                <option value="table">Tabla de Datos</option>
                <option value="text">Anotación / Texto</option>
              </select>
            </div>

            <div className="field" style={{ marginTop: '12px' }}>
              <label htmlFor="sb-span">Ancho en Cuadrícula (12 columnas)</label>
              <select
                id="sb-span"
                value={colSpan}
                onChange={e => setColSpan(Number(e.target.value))}
              >
                <option value={3}>3 Columnas (25% del ancho)</option>
                <option value={4}>4 Columnas (33% del ancho)</option>
                <option value={6}>6 Columnas (50% del ancho)</option>
                <option value={8}>8 Columnas (66% del ancho)</option>
                <option value={12}>12 Columnas (100% ancho completo)</option>
              </select>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

          {/* Section: Datos y Modelo Semántico */}
          <div>
            <span className="eyebrow secondary" style={{ fontSize: '11px' }}>Datos & Semántica</span>
            <div className="field" style={{ marginTop: '8px' }}>
              <label htmlFor="sb-kpi">KPI Asociado</label>
              <select
                id="sb-kpi"
                value={kpiVersionId}
                onChange={e => {
                  const id = e.target.value;
                  setKpiVersionId(id);
                  const k = kpis.find(item => item.id === id);
                  if (k && k.dimensions.length > 0) {
                    setDimension(k.dimensions[0] ?? '');
                  } else {
                    setDimension('');
                  }
                  if (k?.targets.target !== undefined) {
                    setTargetLineValue(k.targets.target);
                    setTargetLineLabel(`Meta: ${k.targets.target} ${k.unit}`);
                  }
                }}
              >
                <option value="">Sin KPI (Solo texto o tarjeta libre)</option>
                {kpis.map(k => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.slug}) · {k.unit} {k.deprecatedAt ? '· [Deprecado]' : !k.publishedAt ? '· [Borrador]' : '· [Publicado]'}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ marginTop: '12px' }}>
              <label htmlFor="sb-dim">Dimensión de Desglose</label>
              {selectedKpi && selectedKpi.dimensions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <select
                    id="sb-dim"
                    value={dimension}
                    onChange={e => setDimension(e.target.value)}
                  >
                    <option value="">Total general (sin desglose)</option>
                    {selectedKpi.dimensions.map(d => (
                      <option key={d} value={d}>
                        {d} {d === 'day' ? '(Fecha / Serie diaria)' : ''}
                      </option>
                    ))}
                    <option value="__custom__">Campo manual personalizado…</option>
                  </select>
                  {dimension === '__custom__' && (
                    <input
                      placeholder="Nombre exacto del campo"
                      value={customDim}
                      onChange={e => setCustomDim(e.target.value)}
                    />
                  )}
                </div>
              ) : (
                <input
                  id="sb-dim"
                  value={dimension}
                  onChange={e => setDimension(e.target.value)}
                  placeholder="Ej. day, agent, queue, status"
                />
              )}
              <small className="secondary" style={{ fontSize: '11px' }}>
                Agrupa las filas por este campo para generar series en la gráfica o tabla.
              </small>
            </div>

            <div className="field" style={{ marginTop: '12px' }}>
              <label htmlFor="sb-date-field">Columna de Fecha (Opcional)</label>
              <input
                id="sb-date-field"
                value={dateField}
                onChange={e => setDateField(e.target.value)}
                placeholder="Ej. fecha, created_at, call_date (vacío = auto/global)"
              />
              <small className="secondary" style={{ fontSize: '11px' }}>
                Si este KPI usa una fecha distinta al filtro global o deseas anularla, indica el nombre de columna aquí.
              </small>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

          {/* Section: Estilo y Paleta de Color */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Palette size={14} className="secondary" />
              <span className="eyebrow secondary" style={{ fontSize: '11px' }}>Paleta de Color</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              {PALETTE.map(p => (
                <button
                  key={p.color}
                  type="button"
                  onClick={() => setColor(p.color)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: `1px solid ${color === p.color ? 'var(--ink)' : 'var(--border)'}`,
                    background: color === p.color ? 'var(--surface-muted)' : 'var(--surface)',
                    fontSize: '12px',
                  }}
                >
                  <span
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: p.color,
                      display: 'inline-block',
                    }}
                  />
                  <span>{p.name}</span>
                  {color === p.color && <Check size={12} />}
                </button>
              ))}
            </div>

            <div className="field" style={{ marginTop: '10px' }}>
              <label htmlFor="sb-custom-color" style={{ fontSize: '11px' }}>Color Hex personalizado</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  id="sb-custom-color"
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  style={{ width: '36px', height: '32px', padding: 0, border: '1px solid var(--border)', cursor: 'pointer' }}
                />
                <input
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  style={{ width: '100px', fontSize: '12px' }}
                />
              </div>
            </div>
          </div>

          {/* Section: Indicador de Meta (para gráficas) */}
          {['line_chart', 'bar_chart', 'area_chart'].includes(type) && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <Target size={14} style={{ color: 'var(--warning)' }} />
                  <span className="eyebrow secondary" style={{ fontSize: '11px' }}>Línea de Meta (Benchmark)</span>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={showTargetLine}
                    onChange={e => setShowTargetLine(e.target.checked)}
                  />
                  <span>Dibujar línea de meta horizontal en la gráfica</span>
                </label>

                {showTargetLine && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="field">
                      <label htmlFor="sb-target-val">Valor de la Meta</label>
                      <input
                        id="sb-target-val"
                        type="number"
                        step="any"
                        placeholder="Ej. 0.85 o 85"
                        value={targetLineValue !== undefined ? targetLineValue : ''}
                        onChange={e => setTargetLineValue(e.target.value !== '' ? Number(e.target.value) : undefined)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="sb-target-lbl">Etiqueta de la Línea</label>
                      <input
                        id="sb-target-lbl"
                        placeholder="Ej. Meta Objetivo (85%)"
                        value={targetLineLabel}
                        onChange={e => setTargetLineLabel(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Section: Columnas Calculadas y Formato Condicional (para Tablas) */}
          {type === 'table' && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <Calculator size={14} style={{ color: 'var(--accent)' }} />
                  <span className="eyebrow secondary" style={{ fontSize: '11px' }}>Columna Calculada</span>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={computedEnabled}
                    onChange={e => setComputedEnabled(e.target.checked)}
                  />
                  <span>Agregar columna derivada calculada</span>
                </label>

                {computedEnabled && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="field">
                      <label htmlFor="sb-comp-name">Nombre de la columna</label>
                      <input
                        id="sb-comp-name"
                        value={computedName}
                        onChange={e => setComputedName(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="sb-comp-type">Transformación</label>
                      <select
                        id="sb-comp-type"
                        value={calculationType}
                        onChange={e => setCalculationType(e.target.value as any)}
                      >
                        <option value="percent_of_target">% de Cumplimiento sobre Meta</option>
                        <option value="diff_from_target">Diferencia neta vs Meta (Valor - Meta)</option>
                        <option value="multiply_100">Multiplicar por 100 (Escala 0–1 a %)</option>
                        <option value="custom">Factor multiplicador personalizado</option>
                      </select>
                    </div>
                    {calculationType === 'custom' && (
                      <div className="field">
                        <label htmlFor="sb-comp-mult">Factor multiplicador</label>
                        <input
                          id="sb-comp-mult"
                          type="number"
                          step="any"
                          value={customMultiplier}
                          onChange={e => setCustomMultiplier(Number(e.target.value))}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <Sliders size={14} style={{ color: 'var(--positive)' }} />
                  <span className="eyebrow secondary" style={{ fontSize: '11px' }}>Formato Condicional</span>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={condEnabled}
                    onChange={e => setCondEnabled(e.target.checked)}
                  />
                  <span>Activar semaforización condicional por umbrales</span>
                </label>

                {condEnabled && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="field">
                      <label htmlFor="sb-cond-green">Umbral Verde (Meta alcanzada o superior)</label>
                      <input
                        id="sb-cond-green"
                        type="number"
                        step="any"
                        placeholder="Ej. 0.85 o 85"
                        value={greenThreshold !== undefined ? greenThreshold : ''}
                        onChange={e => setGreenThreshold(e.target.value !== '' ? Number(e.target.value) : undefined)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="sb-cond-red">Umbral Rojo (Bajo rendimiento crítico)</label>
                      <input
                        id="sb-cond-red"
                        type="number"
                        step="any"
                        placeholder="Ej. 0.50 o 50"
                        value={redThreshold !== undefined ? redThreshold : ''}
                        onChange={e => setRedThreshold(e.target.value !== '' ? Number(e.target.value) : undefined)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="sb-cond-mode">Estilo visual</label>
                      <select
                        id="sb-cond-mode"
                        value={condMode}
                        onChange={e => setCondMode(e.target.value as any)}
                      >
                        <option value="badge">Insignia (Badge con color)</option>
                        <option value="background">Fondo de celda sutil</option>
                        <option value="bar">Barra de progreso inline</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Section: Text annotations */}
          {type === 'text' && (
            <div>
              <span className="eyebrow secondary" style={{ fontSize: '11px' }}>Contenido de Anotación</span>
              <div className="field" style={{ marginTop: '8px' }}>
                <textarea
                  rows={4}
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                  placeholder="Escribe comentarios, objetivos o instrucciones operacionales para el equipo…"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            className="button"
            onClick={() => {
              if (confirm('¿Deseas eliminar este widget del dashboard?')) {
                onDelete(widget.id);
                onClose();
              }
            }}
            style={{ color: 'var(--negative)', borderColor: 'var(--border)' }}
          >
            <Trash2 size={14} />
            <span>Eliminar</span>
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="button primary" onClick={handleSave}>
              Aplicar cambios
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
