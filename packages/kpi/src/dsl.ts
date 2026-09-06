import { DomainError, type SourceField } from '@atlas/contracts';
type Scalar = 'numeric' | 'string' | 'boolean' | 'date' | 'datetime' | 'null';
export type Ast = { kind: 'literal'; value: string | boolean | null; type: Scalar } | { kind: 'field'; name: string } | { kind: 'call'; name: string; args: Ast[] } | { kind: 'binary'; op: string; left: Ast; right: Ast } | { kind: 'unary'; op: string; value: Ast };
const fail = (code = 'INVALID_FORMULA'): never => { throw new DomainError(code, 400, 'Fórmula inválida: revisa funciones, campos, tipos y agregaciones.'); };
type Token = { text: string; kind: 'word' | 'number' | 'string' | 'symbol' };
export function parseFormula(text: string): Ast {
  if (!text.length || text.length > 4000) return fail('FORMULA_LIMIT');
  const tokens: Token[] = []; let offset = 0;
  while (offset < text.length) {
    const rest = text.slice(offset), space = /^\s+/.exec(rest);
    if (space) { offset += space[0].length; continue; }
    const match = /^(?:([a-zA-Z_][a-zA-Z0-9_.]*)|(\d+(?:\.\d+)?)|('(?:[^']|'')*')|(!=|<=|>=|[+*/(),=<>-]))/.exec(rest);
    if (!match) return fail();
    tokens.push({ text: match[0], kind: match[1] ? 'word' : match[2] ? 'number' : match[3] ? 'string' : 'symbol' }); offset += match[0].length;
    if (tokens.length > 500) return fail('FORMULA_LIMIT');
  }
  let position = 0, nodes = 0;
  const peek = () => tokens[position]?.text.toUpperCase();
  const consume = (expected: string) => { if (peek() !== expected) fail(); position++; };
  const precedence: Record<string, number> = { OR: 1, AND: 2, '=': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5 };
  function expression(min = 0, depth = 0): Ast {
    if (depth > 30 || ++nodes > 200) return fail('FORMULA_LIMIT');
    const token = tokens[position++]; if (!token) return fail(); let left: Ast;
    const upper = token.text.toUpperCase();
    if (['-', '+', 'NOT'].includes(upper)) left = { kind: 'unary', op: upper, value: expression(upper === 'NOT' ? 3 : 6, depth + 1) };
    else if (token.text === '(') { left = expression(0, depth + 1); consume(')'); }
    else if (token.kind === 'number') { if (token.text.replace('.', '').length > 38) return fail(); left = { kind: 'literal', type: 'numeric', value: token.text }; }
    else if (token.kind === 'string') left = { kind: 'literal', type: 'string', value: token.text.slice(1, -1).replaceAll("''", "'") };
    else if (upper === 'NULL') left = { kind: 'literal', type: 'null', value: null };
    else if (upper === 'TRUE' || upper === 'FALSE') left = { kind: 'literal', type: 'boolean', value: upper === 'TRUE' };
    else if (token.kind === 'word' && peek() === '(') {
      position++; const args: Ast[] = [];
      if (peek() !== ')') { args.push(expression(0, depth + 1)); while (peek() === ',') { position++; args.push(expression(0, depth + 1)); } }
      consume(')'); left = { kind: 'call', name: upper, args };
    } else if (token.kind === 'word') left = { kind: 'field', name: token.text };
    else return fail();
    while (peek() && (precedence[peek()!] ?? -1) >= min) {
      const op = tokens[position++]!.text.toUpperCase(); left = { kind: 'binary', op, left, right: expression(precedence[op]! + 1, depth + 1) };
    }
    return left;
  }
  const ast = expression(); if (position !== tokens.length) return fail(); return ast;
}
export type TableContext = {
  slug: string;
  alias: string;
  fields: readonly SourceField[];
};

export function extractReferencedTables(ast: Ast): string[] {
  const tables = new Set<string>();
  function walk(node: Ast) {
    if (node.kind === 'field') {
      const parts = node.name.split('.');
      if (parts.length === 2 && parts[0]) tables.add(parts[0]);
    } else if (node.kind === 'call') {
      node.args.forEach(walk);
    } else if (node.kind === 'binary') {
      walk(node.left); walk(node.right);
    } else if (node.kind === 'unary') {
      walk(node.value);
    }
  }
  walk(ast);
  return Array.from(tables);
}

type Compiled = { sql: string; type: Scalar; aggregate: boolean; row: boolean };

export function compileFormula(
  ast: Ast,
  fieldsOrTables: readonly SourceField[] | TableContext[],
  table: string,
  parameters: unknown[]
): { sql: string; hasDivision: boolean; referencedTables: string[] } {
  const isTableContextArray = (items: readonly unknown[]): items is TableContext[] =>
    items.length > 0 && typeof items[0] === 'object' && items[0] !== null && 'alias' in items[0];

  const tables: TableContext[] = isTableContextArray(fieldsOrTables)
    ? fieldsOrTables
    : [{ slug: table, alias: '', fields: fieldsOrTables as readonly SourceField[] }];

  const referencedTables = new Set<string>();
  const divisions: string[] = [];
  const bind = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };
  const compatible = (a: Scalar, b: Scalar) => a === b || a === 'null' || b === 'null';
  const numeric = (a: Scalar) => a === 'numeric' || a === 'null';
  const combine = (args: Compiled[]) => ({ aggregate: args.some(arg => arg.aggregate), row: args.some(arg => arg.row) });

  function visit(node: Ast): Compiled {
    if (node.kind === 'literal') return { sql: node.type === 'null' ? 'NULL' : `${bind(node.value)}::${node.type === 'numeric' ? 'numeric' : node.type === 'boolean' ? 'boolean' : 'text'}`, type: node.type, aggregate: false, row: false };
    if (node.kind === 'field') {
      const parts = node.name.split('.');
      if (parts.length > 2) return fail('UNKNOWN_FIELD');
      let targetTable: TableContext | undefined;
      let targetFieldName: string;
      if (parts.length === 2) {
        targetTable = tables.find(t => t.slug === parts[0]);
        if (!targetTable) return fail('UNKNOWN_FIELD');
        targetFieldName = parts[1]!;
      } else {
        targetTable = tables.find(t => t.slug === table) ?? tables[0];
        targetFieldName = parts[0]!;
      }
      if (!targetTable) return fail('UNKNOWN_FIELD');
      const field = targetTable.fields.find(f => f.target === targetFieldName);
      if (!field) return fail('UNKNOWN_FIELD');
      referencedTables.add(targetTable.slug);
      const type: Scalar = ['integer','decimal','duration'].includes(field.type) ? 'numeric' : field.type as Scalar;
      const colPrefix = targetTable.alias ? `${targetTable.alias}.` : '';
      return { sql: `(${colPrefix}values ->> ${bind(field.target)}::text)::${type === 'numeric' ? 'numeric' : type === 'string' ? 'text' : type === 'datetime' ? 'timestamptz' : type}`, type, aggregate: false, row: true };
    }
    if (node.kind === 'unary') {
      const arg = visit(node.value); if (node.op === 'NOT' ? arg.type !== 'boolean' : !numeric(arg.type)) return fail('FORMULA_TYPE');
      return { ...arg, sql: `(${node.op} ${arg.sql})` };
    }
    if (node.kind === 'binary') {
      const a = visit(node.left), b = visit(node.right), flags = combine([a,b]);
      if (['AND','OR'].includes(node.op)) { if (a.type !== 'boolean' || b.type !== 'boolean') return fail('FORMULA_TYPE'); return { ...flags, type: 'boolean', sql: `(${a.sql} ${node.op} ${b.sql})` }; }
      if (['=','!=','<','<=','>','>='].includes(node.op)) { if (!compatible(a.type,b.type)) return fail('FORMULA_TYPE'); return { ...flags, type: 'boolean', sql: `(${a.sql} ${node.op} ${b.sql})` }; }
      if (!numeric(a.type) || !numeric(b.type)) return fail('FORMULA_TYPE');
      if (node.op === '/') divisions.push(`(${b.sql}) = 0`);
      return { ...flags, type: 'numeric', sql: node.op === '/' ? `(${a.sql} / NULLIF(${b.sql},0))` : `(${a.sql} ${node.op} ${b.sql})` };
    }
    const args = node.args.map(visit), name = node.name;
    const arity = (min: number, max = min) => { if (args.length < min || args.length > max) fail('FUNCTION_ARITY'); };
    if (['SUM','AVG','MIN','MAX','COUNT','COUNT_DISTINCT'].includes(name)) {
      arity(1); const arg = args[0]!; if (arg.aggregate) return fail('NESTED_AGGREGATE');
      if (!['COUNT','COUNT_DISTINCT'].includes(name) && !numeric(arg.type)) return fail('FORMULA_TYPE');
      return { sql: name === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${arg.sql})` : `${name}(${arg.sql})`, type: 'numeric', aggregate: true, row: false };
    }
    const flags = combine(args);
    if (name === 'IF') { arity(3); if (args[0]!.type !== 'boolean' || !compatible(args[1]!.type,args[2]!.type)) return fail('FORMULA_TYPE'); return { ...flags, type: args[1]!.type === 'null' ? args[2]!.type : args[1]!.type, sql: `(CASE WHEN ${args[0]!.sql} THEN ${args[1]!.sql} ELSE ${args[2]!.sql} END)` }; }
    if (name === 'COALESCE' || name === 'NULLIF') { arity(2, name === 'COALESCE' ? 10 : 2); const type = args.find(arg => arg.type !== 'null')?.type ?? 'null'; if (args.some(arg => !compatible(arg.type,type))) return fail('FORMULA_TYPE'); return { ...flags, type, sql: `${name}(${args.map(arg => arg.type === 'null' ? 'NULL' : arg.sql).join(',')})` }; }
    if (name === 'ABS' || name === 'ROUND') {
      arity(name === 'ABS' ? 1 : 2); if (!numeric(args[0]!.type)) return fail('FORMULA_TYPE');
      if (name === 'ROUND') { const precision = node.args[1]; if (precision?.kind !== 'literal' || precision.type !== 'numeric' || !/^\d{1,2}$/.test(String(precision.value)) || Number(precision.value) > 12) return fail('ROUND_PRECISION'); }
      return { ...flags, type: 'numeric', sql: `${name}(${args[0]!.sql}${name === 'ROUND' ? `,(${args[1]!.sql})::int` : ''})` };
    }
    if (name === 'DATE') {
      arity(1);
      if (!['date', 'datetime', 'string', 'null'].includes(args[0]!.type)) return fail('FORMULA_TYPE');
      return { ...flags, type: 'date', sql: `(${args[0]!.sql})::date` };
    }
    if (name === 'DATE_DIFF') {
      arity(2, 3);
      const rawUnit = node.args.length === 3 ? node.args[0] : null;
      const unitValue = rawUnit ? (rawUnit.kind === 'literal' && rawUnit.type === 'string' ? String(rawUnit.value) : null) : 'day';
      if (!unitValue || !['day', 'hour', 'minute', 'second', 'month', 'year'].includes(unitValue.toLowerCase())) return fail('INVALID_DATE_UNIT');
      const start = node.args.length === 3 ? args[1]! : args[0]!;
      const end = node.args.length === 3 ? args[2]! : args[1]!;
      if (!['date', 'datetime', 'null'].includes(start.type) || !['date', 'datetime', 'null'].includes(end.type)) return fail('FORMULA_TYPE');
      const unitName = unitValue.toLowerCase();
      const unitFactor = unitName === 'second' ? 1 : unitName === 'minute' ? 60 : unitName === 'hour' ? 3600 : 86400;
      return { ...flags, type: 'numeric', sql: `(EXTRACT(EPOCH FROM (${end.sql}::timestamptz - ${start.sql}::timestamptz)) / ${unitFactor})` };
    }
    if (name === 'DATE_TRUNC') {
      arity(2);
      const part = node.args[0];
      if (!part || part.kind !== 'literal' || part.type !== 'string' || !['day', 'week', 'month', 'quarter', 'year', 'hour'].includes(String(part.value).toLowerCase())) return fail('INVALID_DATE_PART');
      const target = args[1]!;
      if (!['date', 'datetime', 'null'].includes(target.type)) return fail('FORMULA_TYPE');
      return { ...flags, type: 'datetime', sql: `date_trunc(${bind(String(part.value).toLowerCase())}, ${target.sql}::timestamptz)` };
    }
    return fail('FUNCTION_UNAVAILABLE');
  }
  const result = visit(ast);
  if (result.row || !result.aggregate || result.type !== 'numeric') return fail('AGGREGATE_REQUIRED');
  // Evaluate warnings at the same aggregation level, including row-level divisions.
  return { sql: result.sql, hasDivision: divisions.length > 0, referencedTables: Array.from(referencedTables) };
}
