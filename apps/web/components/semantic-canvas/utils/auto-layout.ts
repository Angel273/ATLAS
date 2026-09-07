/**
 * @file auto-layout.ts
 * @description Algoritmo de distribución y posicionamiento determinista (Auto-Layout) para el Lienzo Semántico.
 * Organiza los nodos de datasets en columnas estructuradas a la izquierda y los nodos de KPIs jerárquicamente
 * a la derecha según sus niveles de dependencias recursivas.
 */

import type { Node, Edge } from '@xyflow/react';

/**
 * Calcula coordenadas deterministas para nodos de datasets y KPIs,
 * ubicando tablas en columnas a la izquierda y métricas jerarquizadas a la derecha.
 * @param nodes Lista de nodos a distribuir.
 * @param edges Lista de aristas para deducir relaciones.
 * @returns Copia de nodos con posiciones x, y actualizadas.
 */
export function layoutElements(
  nodes: Node[],
  edges: Edge[]
): Node[] {
  const datasetNodes = nodes.filter(n => n.type === 'datasetNode');
  const kpiNodes = nodes.filter(n => n.type === 'kpiNode');

  const DATASET_COL_WIDTH = 340;
  const DATASET_MARGIN_X = 60;
  const DATASET_MARGIN_Y = 50;

  const KPI_COL_WIDTH = 320;
  const KPI_MARGIN_X = 80;
  const KPI_MARGIN_Y = 40;

  // 1. Position datasets in 1 or 2 columns based on count
  const cols = datasetNodes.length > 3 ? 2 : 1;
  const colHeights = new Array(cols).fill(60);

  const updatedDatasets = datasetNodes.map((node, i) => {
    const colIndex = i % cols;
    const x = 60 + colIndex * (DATASET_COL_WIDTH + DATASET_MARGIN_X);
    const y = colHeights[colIndex]!;

    // Estimate height roughly based on column count
    const colCount = ((node.data?.columns as unknown[]) || []).length;
    const estimatedHeight = 120 + Math.min(colCount, 15) * 32;

    colHeights[colIndex] += estimatedHeight + DATASET_MARGIN_Y;

    return {
      ...node,
      position: { x, y },
    };
  });

  const datasetRightBoundary =
    60 + cols * (DATASET_COL_WIDTH + DATASET_MARGIN_X) + 80;

  // 2. Position KPIs hierarchically according to dependencies
  // Determine depth/level for each KPI
  const kpiMap = new Map<string, Node>();
  kpiNodes.forEach(k => kpiMap.set(k.id, k));

  const kpiDepths = new Map<string, number>();

  function getDepth(nodeId: string, visited = new Set<string>()): number {
    if (visited.has(nodeId)) return 0;
    if (kpiDepths.has(nodeId)) return kpiDepths.get(nodeId)!;

    visited.add(nodeId);
    const kpi = kpiMap.get(nodeId);
    const deps = (kpi?.data?.dependencies as string[]) || [];

    if (!deps.length) {
      kpiDepths.set(nodeId, 0);
      return 0;
    }

    let maxParentDepth = 0;
    for (const depSlug of deps) {
      // Find node with this slug
      const parentNode = kpiNodes.find(n => n.data?.slug === depSlug);
      if (parentNode) {
        maxParentDepth = Math.max(maxParentDepth, 1 + getDepth(parentNode.id, visited));
      }
    }

    kpiDepths.set(nodeId, maxParentDepth);
    return maxParentDepth;
  }

  kpiNodes.forEach(k => getDepth(k.id));

  // Group KPIs by depth
  const depthGroups = new Map<number, Node[]>();
  kpiNodes.forEach(k => {
    const d = kpiDepths.get(k.id) || 0;
    if (!depthGroups.has(d)) depthGroups.set(d, []);
    depthGroups.get(d)!.push(k);
  });

  const updatedKpis: Node[] = [];
  const sortedDepths = Array.from(depthGroups.keys()).sort((a, b) => a - b);

  for (const depth of sortedDepths) {
    const group = depthGroups.get(depth)!;
    const startX = datasetRightBoundary + depth * (KPI_COL_WIDTH + KPI_MARGIN_X);
    let currentY = 60;

    for (const node of group) {
      updatedKpis.push({
        ...node,
        position: { x: startX, y: currentY },
      });
      currentY += 230 + KPI_MARGIN_Y;
    }
  }

  return [...updatedDatasets, ...updatedKpis];
}
