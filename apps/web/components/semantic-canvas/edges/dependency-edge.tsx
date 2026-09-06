'use client';
import { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { DependencyEdgeData } from '../types';

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
    <BaseEdge
      id={id}
      path={edgePath}
      {...(markerEnd ? { markerEnd } : {})}
      style={{
        ...style,
        stroke: isHighlighted ? '#D9531E' : '#2F6FED',
        strokeWidth: isHighlighted ? 3 : 1.75,
        strokeDasharray: '4,4',
        animation: 'dashdraw 0.5s linear infinite',
      }}
    />
  );
});
