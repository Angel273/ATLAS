/**
 * @file semantic-edge.tsx
 * @description Arista visual con enrutamiento suave (SmoothStep) para representar relaciones semánticas entre datasets.
 * Muestra etiquetas interactivas con cardinalidad (1:1, 1:N, N:1), tipo de join (INNER/LEFT) y estado de ruta preferida.
 */

'use client';
import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { Star } from 'lucide-react';
import type { SemanticEdgeData } from '../types';

/**
 * Componente de arista ReactFlow que renderiza una relación semántica con etiqueta de cardinalidad y halo.
 */
export const SemanticEdge = memo(function SemanticEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = data as unknown as SemanticEdgeData;
  const isHighlighted = Boolean(edgeData?.isHighlighted);
  const isPreferred = Boolean(edgeData?.isPreferred);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    borderRadius: 16,
  });

  /** Formatea la clave de cardinalidad a notación estándar relacional (1:1, 1:N, N:1). */
  function formatCardinality(card?: string) {
    if (card === 'one_to_one') return '1:1';
    if (card === 'one_to_many') return '1:N';
    if (card === 'many_to_one') return 'N:1';
    return '1:N';
  }

  const cardinalityLabel = formatCardinality(edgeData?.cardinality);
  const joinTypeLabel = (edgeData?.joinType || 'left').toUpperCase();

  const edgeStyle: React.CSSProperties = {
    ...style,
    stroke: isHighlighted ? '#D9531E' : isPreferred ? 'var(--accent)' : 'var(--border-strong)',
    strokeWidth: isHighlighted ? 3 : 2,
    ...(isHighlighted
      ? { strokeDasharray: '6,6', animation: 'dashdraw 0.6s linear infinite' }
      : {}),
    transition: 'stroke 0.2s, stroke-width 0.2s',
  };

  return (
    <>
      {/* Background halo outline for clean contrast over cards */}
      <BaseEdge
        id={`${id}-halo`}
        path={edgePath}
        style={{
          stroke: 'var(--surface)',
          strokeWidth: 5,
          strokeOpacity: 0.95,
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        style={edgeStyle}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            cursor: 'pointer',
          }}
          className="nodrag nopan"
          onClick={(e) => {
            e.stopPropagation();
            if (typeof edgeData?.onConfigure === 'function') {
              (edgeData.onConfigure as (d: SemanticEdgeData) => void)(edgeData);
            }
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '12px',
              background: isHighlighted ? '#FFF2E6' : 'var(--surface)',
              border: isHighlighted
                ? '1px solid #D9531E'
                : isPreferred
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              fontSize: '10px',
              fontFamily: 'ui-monospace, monospace',
              color: 'var(--ink)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            title={`${edgeData?.fromField || 'campo'} -> ${edgeData?.toField || 'campo'} (${cardinalityLabel} ${joinTypeLabel}) - Clic para configurar`}
          >
            {isPreferred && (
              <span title="Ruta preferida de consulta">
                <Star size={10} style={{ color: '#D97706', fill: '#D97706' }} />
              </span>
            )}
            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{cardinalityLabel}</span>
            <span style={{ color: 'var(--secondary)' }}>{joinTypeLabel}</span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
