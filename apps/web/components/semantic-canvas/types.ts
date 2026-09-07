/**
 * @file types.ts
 * @description Definiciones de tipos e interfaces para el Lienzo Semántico Visual (Semantic Canvas).
 * Modela los datos de nodos de datasets, nodos de KPIs, aristas de relaciones, aristas de dependencias
 * y estructuras de simulación de rutas de consulta.
 */

import type { Cardinality, JoinType, TargetDirection } from '@atlas/contracts';

export type FieldType = 'string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'duration';

export interface DatasetColumn {
  name: string;
  sourceName: string;
  type: FieldType;
  isKey: boolean;
  required: boolean;
}

export interface DatasetNodeData {
  datasetId: string;
  versionId: string;
  name: string;
  slug: string;
  versionNumber: number;
  rowCount: number;
  columns: DatasetColumn[];
  isHighlighted?: boolean | undefined;
  [key: string]: unknown;
}

export interface KpiNodeData {
  id?: string | undefined;
  slug: string;
  name: string;
  description?: string | undefined;
  formula: string;
  unit: 'number' | 'percent' | 'seconds' | 'text';
  precision: number;
  datasetVersionId: string;
  datasetName?: string | undefined;
  datasetSlug?: string | undefined;
  relatedDatasetVersionIds: string[];
  dimensions: string[];
  targetDirection: TargetDirection;
  targets: {
    target?: number | undefined;
    warningThreshold?: number | undefined;
    criticalThreshold?: number | undefined;
  };
  dependencies: string[];
  publishedAt?: string | null | undefined;
  deprecatedAt?: string | null | undefined;
  isHighlighted?: boolean | undefined;
  [key: string]: unknown;
}

export interface SemanticEdgeData {
  relationshipId?: string | undefined;
  fromDatasetId: string;
  fromDatasetSlug: string;
  fromField: string;
  toDatasetId: string;
  toDatasetSlug: string;
  toField: string;
  cardinality: Cardinality;
  joinType: JoinType;
  isPreferred: boolean;
  publishedAt?: string | undefined;
  isHighlighted?: boolean | undefined;
  [key: string]: unknown;
}

export interface DependencyEdgeData {
  fromSlug: string;
  toSlug: string;
  isHighlighted?: boolean | undefined;
  [key: string]: unknown;
}

export type CanvasLayer = 'all' | 'erd' | 'kpis';

export interface SimulatedPath {
  datasetIds: string[];
  edgeIds: string[];
  explanation: string[];
}
