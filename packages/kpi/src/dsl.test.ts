/**
 * @file packages/kpi/src/dsl.test.ts
 * @description Pruebas unitarias para el parser y compilador de la DSL segura de fórmulas analíticas.
 * Valida precedencia de operadores, parametrización segura de literales, funciones temporales (DATE_DIFF),
 * rechazo de inyecciones SQL, agregaciones anidadas, tipos incompatibles y límites de complejidad sintáctica.
 */

import {describe,it,expect} from 'vitest';
import {parseFormula,compileFormula} from './dsl.js';
import type {SourceField} from '@atlas/contracts';

const fields: SourceField[] = [
  {source:'Amount',target:'amount',type:'decimal',required:false},
  {source:'Team',target:'team',type:'string',required:false},
  {source:'CreatedAt',target:'created_at',type:'datetime',required:false},
  {source:'ClosedAt',target:'closed_at',type:'datetime',required:false},
  {source:'CategoriaContacto',target:'categoria_contacto',type:'string',required:false},
];
describe('safe aggregate DSL',()=>{
  it('compiles precedence and binds all values and field keys',()=>{
    const params: unknown[] = ['version'];
    const result=compileFormula(parseFormula("SUM(IF(team = 'A', amount, 0)) / COUNT(amount) * 100"),fields,'calls',params);
    expect(result.sql).toContain('NULLIF'); expect(result.sql).not.toContain("'A'");expect(params).toContain('A');
  });
  it('compiles temporal functions correctly',()=>{
    const params: unknown[] = ['version'];
    const result=compileFormula(parseFormula("AVG(DATE_DIFF('minute', created_at, closed_at))"),fields,'calls',params);
    expect(result.sql).toContain('EXTRACT(EPOCH FROM');
    expect(result.sql).toContain('/ 60');
  });
  it.each(['SUM(amount); DROP TABLE datasets','SUM(unknown)','SUM(SUM(amount))','amount + SUM(amount)','SUM(team)','fetch(amount)','AVG(amount,team)','SUM(other.amount)','SUM(amount) + TRUE','ROUND(SUM(amount),99)','AVG(DATE_DIFF(123, created_at, closed_at))'])('rejects %s',formula=>{
    expect(()=>compileFormula(parseFormula(formula),fields,'calls',[])).toThrow();
  });
  it('compiles text unit formulas and text functions correctly', () => {
    const params: unknown[] = ['version'];
    const result1 = compileFormula(parseFormula("categoria_contacto"), fields, 'calls', params, 'text');
    expect(result1.sql).toContain('MAX((');

    const result2 = compileFormula(parseFormula("MODE(team)"), fields, 'calls', params, 'text');
    expect(result2.sql).toContain('MODE() WITHIN GROUP');

    const result3 = compileFormula(parseFormula("MAX(team)"), fields, 'calls', params, 'text');
    expect(result3.sql).toContain('MAX((');
  });
  it('bounds complexity',()=>{expect(()=>parseFormula('('.repeat(40)+'1'+')'.repeat(40))).toThrow();});
});
