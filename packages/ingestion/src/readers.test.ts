/**
 * @file packages/ingestion/src/readers.test.ts
 * @description Pruebas unitarias para lectores de hojas de cálculo y desinfección de encabezados.
 * Valida la lectura streaming de XLSX, manejo seguro de valores cacheados de fórmulas,
 * celdas vacías y desambiguación determinista de nombres de columna duplicados.
 */

import {it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRows} from './readers.js';
import {sanitizeHeaders} from './processor.js';
import type {Regional} from '@atlas/contracts';

const regional:Regional={decimalSeparator:'.',thousandsSeparator:'none',dateFormat:'YYYY-MM-DD',timezone:'UTC',delimiter:','};
it('streams XLSX sheets, preserves empty cells and uses only cached formula values',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'atlas-reader-test-'));
 try{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Operación');
  sheet.addRow(['id','importe','vacío','fecha']);
  sheet.addRow(['a',{formula:'1+2',result:3},null,new Date('2026-04-03T00:00:00Z')]);
  sheet.addRow(['b',{formula:'HYPERLINK("https://invalid.example")'}]);
  const path=join(directory,'synthetic.xlsx');await book.xlsx.writeFile(path);
  const rows=[];for await(const row of readRows(path,'xlsx',regional))rows.push(row);
  expect(rows[0]?.sheet).toBe('Operación');expect(rows[1]?.cells[1]).toBe(3);expect(rows[1]?.cells[2]).toBeNull();
  expect(rows[2]?.cells[1]).toEqual({error:'FORMULA_WITHOUT_CACHED_VALUE'});
 }finally{await rm(join(directory,'synthetic.xlsx'),{force:true});await rmdir(directory);}
});

it('sanitizes headers by disambiguating duplicates and naming empty columns', () => {
  const cells = ['ID', 'Agent', null, 'NPS', 'Agent', null, 'NPS'];
  const sanitized = sanitizeHeaders(cells);
  expect(sanitized).toEqual([
    'ID',
    'Agent',
    'Columna_3',
    'NPS',
    'Agent_2',
    'Columna_6',
    'NPS_2',
  ]);
  expect(new Set(sanitized).size).toBe(sanitized.length);
});
