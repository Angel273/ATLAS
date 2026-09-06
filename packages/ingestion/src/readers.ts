import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import type { Regional } from '@atlas/contracts';
import type { Cell } from './normalize.js';

export async function validateXlsx(path: string): Promise<{ id: number; name: string; rId: string; state: string }[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('INVALID_XLSX')); return; }
      let entries = 0, expanded = 0, workbook = false;
      const sheets: { id: number; name: string; rId: string; state: string }[] = [];
      const fail = (code: string) => { zip.close(); reject(new Error(code)); };
      zip.on('error', () => fail('INVALID_XLSX'));
      zip.on('entry', (entry: yauzl.Entry) => {
        entries++; expanded += entry.uncompressedSize;
        if (entries > 10000 || expanded > 1024 * 1024 * 1024 || entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 1000) return fail('XLSX_EXPANSION_LIMIT');
        if (entry.fileName.includes('..') || entry.fileName.startsWith('/') || /vbaProject|externalLinks|embeddings|\.bin$/i.test(entry.fileName)) return fail('ACTIVE_WORKBOOK_CONTENT');
        if (entry.fileName !== 'xl/workbook.xml') { zip.readEntry(); return; }
        workbook = true;
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail('INVALID_XLSX');
          const parser = new SaxesParser();
          parser.on('opentag', node => {
            if (node.name !== 'sheet') return;
            const value = (name: string) => { const item: unknown = node.attributes[name]; return typeof item === 'string' ? item : item && typeof item === 'object' && 'value' in item ? String(item.value) : undefined; };
            const id = Number(value('sheetId')), name = value('name'), rId = value('r:id');
            if (Number.isInteger(id) && name && rId && name.length <= 200) sheets.push({ id, name, rId, state: value('state') ?? 'visible' });
          });
          stream.on('data', chunk => parser.write(chunk.toString('utf8')));
          stream.on('error', () => fail('INVALID_XLSX'));
          stream.on('end', () => { try { parser.close(); zip.readEntry(); } catch { fail('INVALID_XLSX'); } });
        });
      });
      zip.on('end', () => workbook && sheets.length ? resolve(sheets) : reject(new Error('INVALID_XLSX'))); zip.readEntry();
    });
  });
}
function excelCell(value: ExcelJS.CellValue): Cell {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  if (typeof value === 'object' && 'error' in value) return { error: `EXCEL_ERROR_${String(value.error).replace(/[^A-Za-z0-9]/g, '') || 'VALUE'}` };
  if ('formula' in value || 'sharedFormula' in value) return value.result === undefined ? { error: 'FORMULA_WITHOUT_CACHED_VALUE' } : excelCell(value.result);
  if ('richText' in value) return value.richText.map(part => part.text).join('');
  if ('text' in value) return value.text;
  return { error: 'UNSUPPORTED_CELL_VALUE' };
}
export async function* readRows(path: string, format: string, regional: Regional): AsyncGenerator<{ sheet: string; row: number; cells: Cell[] }> {
  if (format === 'csv') {
    const source = createReadStream(path);
    const parser = source.pipe(parse({ bom: true, delimiter: regional.delimiter, skip_empty_lines: true, max_record_size: 65536, relax_column_count: false }));
    let row = 0;
    try {
      for await (const record of parser) {
        const values: unknown = record;
        if (!Array.isArray(values) || values.length > 200 || values.some(value => typeof value !== 'string' || value.includes('\0') || value.includes('\uFFFD'))) throw new Error('INVALID_CSV_RECORD');
        yield { sheet: 'CSV', row: ++row, cells: values as string[] };
      }
    } finally { source.destroy(); parser.destroy(); }
  } else {
    const sheetModel = await validateXlsx(path);
    const book = new ExcelJS.stream.xlsx.WorkbookReader(path, { entries: 'ignore', sharedStrings: 'cache', styles: 'cache', hyperlinks: 'ignore', worksheets: 'emit' });
    (book as unknown as { model: { sheets: typeof sheetModel } }).model = { sheets: sheetModel };
    let sheets = 0;
    for await (const sheet of book) {
      if (++sheets > 30) throw new Error('SHEET_LIMIT');
      const name = sheetModel[sheets - 1]?.name;
      if (!name) throw new Error('INVALID_XLSX');
      for await (const row of sheet) {
        if (row.cellCount > 200) throw new Error('COLUMN_LIMIT');
        const values = Array.from({ length: row.cellCount }, (_, index) => excelCell(row.getCell(index + 1).value));
        if (values.some(value => value !== null)) yield { sheet: name, row: row.number, cells: values };
      }
    }
  }
}
