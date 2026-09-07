/**
 * @file kpi-node.tsx
 * @description Nodo visual para indicadores (KPIs) en el Lienzo Semántico.
 * Muestra el nombre, slug, fórmula DSL, unidad de medida, metas operacionales
 * (objetivo, advertencia, crítico) y handles de entrada/salida para dependencias y datasets.
 */

'use client';
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Activity, Percent, Clock, Hash, ArrowUpRight, ArrowDownRight, Target, Edit3 } from 'lucide-react';
import type { KpiNodeData } from '../types';

/**
 * Renderiza la etiqueta visual de unidad de medida para el KPI (% porcentaje, seg segundos, o numérico).
 */
function UnitBadge({ unit }: { unit: 'number' | 'percent' | 'seconds' }) {
  switch (unit) {
    case 'percent':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#E2F0EA', color: '#255C41', fontWeight: 600 }}>
          <Percent size={10} /> %
        </span>
      );
    case 'seconds':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#F2E8DC', color: '#873B1B', fontWeight: 600 }}>
          <Clock size={10} /> SEG
        </span>
      );
    case 'number':
    default:
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#E3EAF2', color: '#1F476B', fontWeight: 600 }}>
          <Hash size={10} /> NUM
        </span>
      );
  }
}

/**
 * Componente de nodo ReactFlow que representa una métrica o KPI gobernado en el canvas.
 */
export const KpiNode = memo(function KpiNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as KpiNodeData;
  const isHighlighted = Boolean(nodeData.isHighlighted);
  const isDeprecated = Boolean(nodeData.deprecatedAt);

  const targets = nodeData.targets || {};
  const hasTargets = targets.target !== undefined || targets.warningThreshold !== undefined || targets.criticalThreshold !== undefined;

  return (
    <div
      style={{
        width: 300,
        borderRadius: '6px',
        background: 'var(--surface)',
        border: selected
          ? '2px solid var(--accent)'
          : isHighlighted
            ? '2px solid #D9531E'
            : isDeprecated
              ? '1px dashed var(--muted)'
              : '1px solid var(--border-strong)',
        boxShadow: selected || isHighlighted
          ? '0 8px 24px rgba(29, 29, 27, 0.16)'
          : '0 4px 12px rgba(29, 29, 27, 0.08)',
        opacity: isDeprecated ? 0.7 : 1,
        transition: 'border-color 0.2s, box-shadow 0.2s, opacity 0.2s',
        overflow: 'hidden',
        fontFamily: 'var(--sans)',
      }}
    >
      {/* Target handle for dependencies or dataset link */}
      <Handle
        type="target"
        position={Position.Left}
        id="kpi-target"
        style={{
          background: '#2F6FED',
          width: 10,
          height: 10,
          border: '2px solid var(--surface)',
          left: -5,
        }}
        title="Dependencia de entrada"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="kpi-target-top"
        style={{
          background: '#2F6FED',
          width: 10,
          height: 10,
          border: '2px solid var(--surface)',
          top: -5,
        }}
      />

      {/* Header */}
      <div
        style={{
          background: isDeprecated
            ? 'var(--surface-muted)'
            : isHighlighted
              ? 'linear-gradient(135deg, #FAF3E6 0%, #F5E8D3 100%)'
              : 'linear-gradient(135deg, #F5F7F9 0%, #EDF1F5 100%)',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '4px',
            background: isDeprecated ? 'var(--muted)' : '#2F6FED',
            color: '#FFFFFF',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Activity size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={nodeData.slug}
            >
              {nodeData.slug}
            </span>
            <UnitBadge unit={nodeData.unit} />
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={nodeData.name}
          >
            {nodeData.name}
          </div>
        </div>

        {typeof nodeData.onEdit === 'function' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (nodeData.onEdit as () => void)();
            }}
            title="Editar KPI y Fórmula"
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '3px',
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              color: 'var(--secondary)',
            }}
          >
            <Edit3 size={12} />
          </button>
        )}
      </div>

      {/* Dataset & Direction info */}
      <div
        style={{
          padding: '6px 14px',
          background: 'var(--canvas)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--secondary)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
          {nodeData.datasetSlug ? `Base: ${nodeData.datasetSlug}` : 'Dataset asociado'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontWeight: 500 }}>
          {nodeData.targetDirection === 'higher_is_better' && (
            <span style={{ color: 'var(--positive)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
              <ArrowUpRight size={12} /> Mayor
            </span>
          )}
          {nodeData.targetDirection === 'lower_is_better' && (
            <span style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
              <ArrowDownRight size={12} /> Menor
            </span>
          )}
          {nodeData.targetDirection === 'target_match' && (
            <span style={{ color: 'var(--info)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
              <Target size={12} /> Exacto
            </span>
          )}
        </span>
      </div>

      {/* Formula preview */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ fontSize: '10px', color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
          Fórmula
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '11px',
            background: 'var(--canvas)',
            padding: '6px 8px',
            borderRadius: '4px',
            border: '1px solid var(--border)',
            color: 'var(--ink)',
            maxHeight: 52,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: 1.4,
          }}
          title={nodeData.formula}
        >
          {nodeData.formula}
        </div>
      </div>

      {/* Targets (Traffic light / Goals) */}
      {hasTargets && (
        <div
          style={{
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            background: 'rgba(0, 0, 0, 0.02)',
          }}
        >
          <div style={{ display: 'flex', gap: '10px' }}>
            {targets.target !== undefined && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--positive)', fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--positive)' }} />
                {targets.target}
              </span>
            )}
            {targets.warningThreshold !== undefined && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--warning)', fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)' }} />
                {targets.warningThreshold}
              </span>
            )}
            {targets.criticalThreshold !== undefined && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--negative)', fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--negative)' }} />
                {targets.criticalThreshold}
              </span>
            )}
          </div>
          {nodeData.dependencies && nodeData.dependencies.length > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--secondary)' }}>
              {nodeData.dependencies.length} {nodeData.dependencies.length === 1 ? 'dep' : 'deps'}
            </span>
          )}
        </div>
      )}

      {/* Outgoing handles towards dependent composite KPIs */}
      <Handle
        type="source"
        position={Position.Right}
        id="kpi-source"
        style={{
          background: '#2F6FED',
          width: 10,
          height: 10,
          border: '2px solid var(--surface)',
          right: -5,
        }}
        title="Dependencia de salida hacia KPI compuesto"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="kpi-source-bottom"
        style={{
          background: '#2F6FED',
          width: 10,
          height: 10,
          border: '2px solid var(--surface)',
          bottom: -5,
        }}
      />
    </div>
  );
});
