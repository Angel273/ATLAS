import { describe, it, expect } from 'vitest';
import { resolveJoinPaths, detectKpiCycles, evaluateTarget, type RelationshipRecord, type DatasetNode } from './relations.js';

describe('relations and multi-table graph routing', () => {
  const rootNode: DatasetNode = { id: 'ds-calls', slug: 'calls', versionId: 'v-calls-1' };
  const agentsNode: DatasetNode = { id: 'ds-agents', slug: 'agents', versionId: 'v-agents-1' };
  const teamsNode: DatasetNode = { id: 'ds-teams', slug: 'teams', versionId: 'v-teams-1' };

  const available = new Map<string, DatasetNode>([
    [rootNode.id, rootNode],
    [agentsNode.id, agentsNode],
    [teamsNode.id, teamsNode],
  ]);

  it('returns empty array when only root table is required', () => {
    const joins = resolveJoinPaths(rootNode, [rootNode.id], available, []);
    expect(joins).toEqual([]);
  });

  it('resolves a direct join between two tables', () => {
    const relationships: RelationshipRecord[] = [
      {
        id: 'rel-1',
        fromDatasetId: rootNode.id,
        fromDatasetSlug: rootNode.slug,
        fromField: 'agent_id',
        toDatasetId: agentsNode.id,
        toDatasetSlug: agentsNode.slug,
        toField: 'id',
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: false,
      },
    ];

    const joins = resolveJoinPaths(rootNode, [agentsNode.id], available, relationships);
    expect(joins).toHaveLength(1);
    expect(joins[0]!.tableSlug).toBe('agents');
    expect(joins[0]!.fromField).toBe('agent_id');
    expect(joins[0]!.toField).toBe('id');
    expect(joins[0]!.joinType).toBe('left');
  });

  it('resolves a multi-hop chain (calls -> agents -> teams)', () => {
    const relationships: RelationshipRecord[] = [
      {
        id: 'rel-1',
        fromDatasetId: rootNode.id,
        fromDatasetSlug: rootNode.slug,
        fromField: 'agent_id',
        toDatasetId: agentsNode.id,
        toDatasetSlug: agentsNode.slug,
        toField: 'id',
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: false,
      },
      {
        id: 'rel-2',
        fromDatasetId: agentsNode.id,
        fromDatasetSlug: agentsNode.slug,
        fromField: 'team_id',
        toDatasetId: teamsNode.id,
        toDatasetSlug: teamsNode.slug,
        toField: 'id',
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: false,
      },
    ];

    const joins = resolveJoinPaths(rootNode, [teamsNode.id], available, relationships);
    expect(joins).toHaveLength(2);
    expect(joins[0]!.tableSlug).toBe('agents');
    expect(joins[1]!.tableSlug).toBe('teams');
  });

  it('throws RELATION_REQUIRED when disconnected', () => {
    try {
      resolveJoinPaths(rootNode, [teamsNode.id], available, []);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('RELATION_REQUIRED');
    }
  });

  it('throws AMBIGUOUS_JOIN_PATH when multiple paths exist without a preferred one', () => {
    const relationships: RelationshipRecord[] = [
      {
        id: 'rel-direct',
        fromDatasetId: rootNode.id,
        fromDatasetSlug: rootNode.slug,
        fromField: 'team_id',
        toDatasetId: teamsNode.id,
        toDatasetSlug: teamsNode.slug,
        toField: 'id',
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: false,
      },
      {
        id: 'rel-alt',
        fromDatasetId: rootNode.id,
        fromDatasetSlug: rootNode.slug,
        fromField: 'account_team_id',
        toDatasetId: teamsNode.id,
        toDatasetSlug: teamsNode.slug,
        toField: 'id',
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: false,
      },
    ];

    try {
      resolveJoinPaths(rootNode, [teamsNode.id], available, relationships);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('AMBIGUOUS_JOIN_PATH');
    }
  });

  it('uses preferred relationship to resolve ambiguity', () => {
    const relationships: RelationshipRecord[] = [
      {
        id: 'rel-direct',
        fromDatasetId: rootNode.id,
        fromDatasetSlug: rootNode.slug,
        fromField: 'team_id',
        toDatasetId: teamsNode.id,
        toDatasetSlug: teamsNode.slug,
        toField: 'id',
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: true, // Marked preferred!
      },
      {
        id: 'rel-alt',
        fromDatasetId: rootNode.id,
        fromDatasetSlug: rootNode.slug,
        fromField: 'account_team_id',
        toDatasetId: teamsNode.id,
        toDatasetSlug: teamsNode.slug,
        toField: 'id',
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: false,
      },
    ];

    const joins = resolveJoinPaths(rootNode, [teamsNode.id], available, relationships);
    expect(joins).toHaveLength(1);
    expect(joins[0]!.fromField).toBe('team_id');
  });
});

describe('KPI cycle detection', () => {
  it('detects self-dependency', () => {
    try {
      detectKpiCycles('kpi_a', ['kpi_a'], new Map());
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CIRCULAR_KPI_DEPENDENCY');
    }
  });

  it('detects 2-cycle (A -> B -> A)', () => {
    const existing = new Map<string, string[]>([['kpi_b', ['kpi_a']]]);
    try {
      detectKpiCycles('kpi_a', ['kpi_b'], existing);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CIRCULAR_KPI_DEPENDENCY');
    }
  });

  it('accepts valid DAG (A -> B -> C)', () => {
    const existing = new Map<string, string[]>([
      ['kpi_b', ['kpi_c']],
      ['kpi_c', []],
    ]);
    expect(() => detectKpiCycles('kpi_a', ['kpi_b'], existing)).not.toThrow();
  });
});

describe('target evaluation', () => {
  it('evaluates higher_is_better', () => {
    const targets = { target: 85, warningThreshold: 70, criticalThreshold: 50 };
    expect(evaluateTarget('90', 'higher_is_better', targets).status).toBe('good');
    expect(evaluateTarget('75', 'higher_is_better', targets).status).toBe('warning');
    expect(evaluateTarget('40', 'higher_is_better', targets).status).toBe('critical');
  });

  it('evaluates lower_is_better', () => {
    const targets = { target: 300, warningThreshold: 360, criticalThreshold: 420 };
    expect(evaluateTarget('280', 'lower_is_better', targets).status).toBe('good');
    expect(evaluateTarget('350', 'lower_is_better', targets).status).toBe('warning');
    expect(evaluateTarget('450', 'lower_is_better', targets).status).toBe('critical');
  });

  it('returns neutral if no target or null value', () => {
    expect(evaluateTarget(null, 'higher_is_better', {}).status).toBe('neutral');
    expect(evaluateTarget('100', 'higher_is_better', {}).status).toBe('neutral');
  });
});
