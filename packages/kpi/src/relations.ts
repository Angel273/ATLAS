import { DomainError, type Cardinality, type JoinType, type TargetDirection, type KpiTargets } from '@atlas/contracts';

export type RelationshipRecord = {
  id: string;
  fromDatasetId: string;
  fromDatasetSlug: string;
  fromField: string;
  toDatasetId: string;
  toDatasetSlug: string;
  toField: string;
  cardinality: Cardinality;
  joinType: JoinType;
  isPreferred: boolean;
};

export type DatasetNode = {
  id: string;
  slug: string;
  versionId: string;
};

export type ResolvedJoin = {
  tableSlug: string;
  alias: string;
  versionId: string;
  joinType: JoinType;
  fromAlias: string;
  fromField: string;
  toField: string;
  pathDescription: string;
};

type GraphEdge = {
  relationship: RelationshipRecord;
  targetDatasetId: string;
  targetDatasetSlug: string;
  sourceField: string;
  targetField: string;
  joinType: JoinType;
  isPreferred: boolean;
};

/**
 * Builds join graph and computes deterministic, unambiguous paths from the root dataset
 * to all target datasets involved in the query.
 */
export function resolveJoinPaths(
  root: DatasetNode,
  requiredDatasetIds: string[],
  availableDatasets: Map<string, DatasetNode>,
  relationships: RelationshipRecord[]
): ResolvedJoin[] {
  const targets = Array.from(new Set(requiredDatasetIds.filter(id => id !== root.id)));
  if (targets.length === 0) return [];

  // Build undirected graph of available relationships
  const graph = new Map<string, GraphEdge[]>();
  for (const rel of relationships) {
    if (!graph.has(rel.fromDatasetId)) graph.set(rel.fromDatasetId, []);
    if (!graph.has(rel.toDatasetId)) graph.set(rel.toDatasetId, []);

    // Forward edge
    graph.get(rel.fromDatasetId)!.push({
      relationship: rel,
      targetDatasetId: rel.toDatasetId,
      targetDatasetSlug: rel.toDatasetSlug,
      sourceField: rel.fromField,
      targetField: rel.toField,
      joinType: rel.joinType,
      isPreferred: rel.isPreferred,
    });

    // Backward edge (reverse cardinality direction if needed)
    graph.get(rel.toDatasetId)!.push({
      relationship: rel,
      targetDatasetId: rel.fromDatasetId,
      targetDatasetSlug: rel.fromDatasetSlug,
      sourceField: rel.toField,
      targetField: rel.fromField,
      joinType: rel.joinType,
      isPreferred: rel.isPreferred,
    });
  }

  // Find all simple paths from root to each target using BFS/DFS
  const resolvedJoins: ResolvedJoin[] = [];
  const joinedDatasets = new Set<string>([root.id]);
  const aliasMap = new Map<string, string>([[root.id, 'source']]);
  let aliasCounter = 1;

  for (const targetId of targets) {
    if (!availableDatasets.has(targetId)) {
      throw new DomainError('RELATION_REQUIRED', 400, `Dataset relacionado no disponible para el tenant.`);
    }

    const allPaths: GraphEdge[][] = [];
    function findPaths(currentId: string, visited: Set<string>, currentPath: GraphEdge[]) {
      if (currentId === targetId) {
        allPaths.push([...currentPath]);
        return;
      }
      const neighbors = graph.get(currentId) ?? [];
      for (const edge of neighbors) {
        if (!visited.has(edge.targetDatasetId)) {
          visited.add(edge.targetDatasetId);
          currentPath.push(edge);
          findPaths(edge.targetDatasetId, visited, currentPath);
          currentPath.pop();
          visited.delete(edge.targetDatasetId);
        }
      }
    }

    findPaths(root.id, new Set([root.id]), []);

    if (allPaths.length === 0) {
      const targetSlug = availableDatasets.get(targetId)?.slug ?? targetId;
      throw new DomainError('RELATION_REQUIRED', 400, `No existe relación publicada para conectar '${root.slug}' con '${targetSlug}'.`);
    }

    // Disambiguation logic:
    // 1. If single path, use it.
    // 2. If multiple paths, check if shortest path or preferred path exists.
    let chosenPath: GraphEdge[];
    if (allPaths.length === 1) {
      chosenPath = allPaths[0]!;
    } else {
      // Look for paths where all edges are preferred or at least one preferred edge breaks the tie
      const minLength = Math.min(...allPaths.map(p => p.length));
      const shortestPaths = allPaths.filter(p => p.length === minLength);

      const preferredShortest = shortestPaths.filter(p => p.some(e => e.isPreferred));
      if (preferredShortest.length === 1) {
        chosenPath = preferredShortest[0]!;
      } else {
        throw new DomainError(
          'AMBIGUOUS_JOIN_PATH',
          400,
          `Existen múltiples rutas de relación entre '${root.slug}' y '${availableDatasets.get(targetId)?.slug}'. Marca una relación como preferida.`
        );
      }
    }

    // Materialize joins along the chosen path
    let currentFromId = root.id;
    for (const edge of chosenPath) {
      const nextId = edge.targetDatasetId;
      if (!joinedDatasets.has(nextId)) {
        joinedDatasets.add(nextId);
        const nextAlias = `t${aliasCounter++}`;
        aliasMap.set(nextId, nextAlias);

        const node = availableDatasets.get(nextId)!;
        resolvedJoins.push({
          tableSlug: node.slug,
          alias: nextAlias,
          versionId: node.versionId,
          joinType: edge.joinType,
          fromAlias: aliasMap.get(currentFromId)!,
          fromField: edge.sourceField,
          toField: edge.targetField,
          pathDescription: `${aliasMap.get(currentFromId)}.${edge.sourceField} = ${nextAlias}.${edge.targetField}`,
        });
      }
      currentFromId = nextId;
    }
  }

  return resolvedJoins;
}

/**
 * Validates that there are no circular dependencies between KPIs.
 * E.g., KPI A depends on KPI B, and KPI B depends on KPI A.
 */
export function detectKpiCycles(
  currentSlug: string,
  dependencies: string[],
  allKpiDependencies: Map<string, string[]>
): void {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(slug: string): boolean {
    visited.add(slug);
    recStack.add(slug);

    const deps = slug === currentSlug ? dependencies : (allKpiDependencies.get(slug) ?? []);
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (dfs(dep)) return true;
      } else if (recStack.has(dep)) {
        return true;
      }
    }

    recStack.delete(slug);
    return false;
  }

  if (dependencies.includes(currentSlug) || dfs(currentSlug)) {
    throw new DomainError('CIRCULAR_KPI_DEPENDENCY', 400, `Dependencia circular detectada para el KPI '${currentSlug}'.`);
  }
}

/**
 * Evaluates a KPI calculated numeric value against its targets and thresholds.
 */
export function evaluateTarget(
  value: string | null,
  direction: TargetDirection = 'higher_is_better',
  targets: KpiTargets = {}
): { status: 'good' | 'warning' | 'critical' | 'neutral'; target: number | null } {
  if (value === null || targets.target === undefined) {
    return { status: 'neutral', target: targets.target ?? null };
  }

  const num = Number(value);
  if (Number.isNaN(num)) {
    return { status: 'neutral', target: targets.target ?? null };
  }

  const target = targets.target;
  const warning = targets.warningThreshold;
  const critical = targets.criticalThreshold;

  if (direction === 'higher_is_better') {
    if (num >= target) return { status: 'good', target };
    if (warning !== undefined && num >= warning) return { status: 'warning', target };
    if (critical !== undefined && num < critical) return { status: 'critical', target };
    return { status: warning !== undefined ? 'warning' : 'critical', target };
  }

  if (direction === 'lower_is_better') {
    if (num <= target) return { status: 'good', target };
    if (warning !== undefined && num <= warning) return { status: 'warning', target };
    if (critical !== undefined && num > critical) return { status: 'critical', target };
    return { status: warning !== undefined ? 'warning' : 'critical', target };
  }

  if (direction === 'target_match') {
    const tolerance = warning !== undefined ? warning : 0.05 * target;
    const diff = Math.abs(num - target);
    if (diff === 0) return { status: 'good', target };
    if (diff <= tolerance) return { status: 'warning', target };
    return { status: 'critical', target };
  }

  return { status: 'neutral', target };
}
