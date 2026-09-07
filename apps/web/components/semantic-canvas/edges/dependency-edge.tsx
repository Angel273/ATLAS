/**
 * @file dependency-edge.tsx
 * @description Arista visual personalizada que representa una dependencia de cálculo entre KPIs en el Lienzo Semántico.
 * Dibuja una línea de Bézier punteada con halo de contraste para legibilidad sobre el fondo.
 */

'use client';
import { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { DependencyEdgeData } from '../types';

/**
 * Componente de arista ReactFlow para enlazar visualmente dependencias entre métricas/KPIs.
 */
export const DependencyEdge = memo(function DependencyEdge({
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
  const edgeData = data as unknown as DependencyEdgeData;
  const isHighlighted = Boolean(edgeData?.isHighlighted);

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  });

  return (
    <>
      {/* Background halo outline for clean contrast and visibility over cards or canvas */}
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
        style={{
          ...style,
          stroke: isHighlighted ? '#D9531E' : '#2F6FED',
          strokeWidth: isHighlighted ? 3 : 2,
          strokeDasharray: '5,5',
          animation: 'dashdraw 0.5s linear infinite',
        }}
      />
    </>
  );
});
