import { describe, it, expect } from 'vitest';
import { wouldIntroduceCycle } from './cycle-detection';

describe('KPI Dependency Cycle Detection', () => {
  it('detects direct self-referential cycle', () => {
    const existing = { tmo: [] };
    const res = wouldIntroduceCycle('tmo', 'tmo', existing);
    expect(res.hasCycle).toBe(true);
    expect(res.cyclePath).toEqual(['tmo', 'tmo']);
  });

  it('allows valid acyclic dependency', () => {
    const existing = {
      tmo: [],
      sla: ['tmo'],
    };
    const res = wouldIntroduceCycle('sla', 'csat', existing);
    expect(res.hasCycle).toBe(false);
  });

  it('detects 2-node cycle (A -> B -> A)', () => {
    const existing = {
      a: [],
      b: ['a'], // b depends on a
    };
    // Trying to make a depend on b (connect b to a)
    const res = wouldIntroduceCycle('b', 'a', existing);
    expect(res.hasCycle).toBe(true);
    expect(res.cyclePath).toEqual(['b', 'a']);
  });

  it('detects deep transitive cycle (A -> B -> C -> A)', () => {
    const existing = {
      a: [],
      b: ['a'], // b depends on a
      c: ['b'], // c depends on b
    };
    // Trying to make a depend on c
    const res = wouldIntroduceCycle('c', 'a', existing);
    expect(res.hasCycle).toBe(true);
    expect(res.cyclePath).toEqual(['c', 'b', 'a']);
  });
});
