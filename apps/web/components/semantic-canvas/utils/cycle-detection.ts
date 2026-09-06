/**
 * Detects if adding a directed dependency edge from `fromSlug` to `toSlug`
 * would introduce a circular dependency cycle in the KPI dependency graph.
 */
export function wouldIntroduceCycle(
  fromSlug: string,
  toSlug: string,
  existingDependencies: Record<string, string[]>
): { hasCycle: boolean; cyclePath?: string[] } {
  // If a KPI points to itself directly
  if (fromSlug === toSlug) {
    return { hasCycle: true, cyclePath: [fromSlug, toSlug] };
  }

  // Build adjacency list including the prospective edge (fromSlug -> toSlug)
  const adj = new Map<string, Set<string>>();
  for (const [kpi, deps] of Object.entries(existingDependencies)) {
    adj.set(kpi, new Set(deps));
  }

  if (!adj.has(toSlug)) {
    adj.set(toSlug, new Set());
  }
  // If we add fromSlug as a dependency of toSlug: toSlug depends on fromSlug
  // (i.e. toSlug -> fromSlug)
  adj.get(toSlug)!.add(fromSlug);

  // We run DFS starting from `fromSlug` to see if we can reach `toSlug`
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(current: string): boolean {
    visited.add(current);
    path.push(current);

    const neighbors = adj.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (neighbor === toSlug) {
          path.push(neighbor);
          return true;
        }
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        }
      }
    }

    path.pop();
    return false;
  }

  const hasCycle = dfs(fromSlug);
  if (hasCycle && path.length > 0) {
    return { hasCycle: true, cyclePath: path };
  }
  return { hasCycle: false };
}
