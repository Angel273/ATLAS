/**
 * @file apps/api/src/workforce/excel-roster.ts
 * @description Parser y generador de plantillas de Rosters de personal Excel para ATLAS.
 * Soporta libros con detección multi-hoja (estructuras tabulares y de asignación directa),
 * mapeo difuso e inteligente de encabezados (código, nombre, BMS ID, Wave, supervisor, semana operativa),
 * normalización de valores de celda y generación de plantillas XLSX estilizadas con ejemplos listos para descargar.
 */

import ExcelJS from 'exceljs';

export interface ParsedRosterRow {
  teamName: string;
  employeeCode?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  bmsId?: string | undefined;
  wave?: string | undefined;
  role?: string | undefined;
  supervisorCode?: string | undefined;
  weekCode?: string | undefined;
}


function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[\s\-_]+/g, '_');
}

function extractCellValue(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if ('result' in val && val.result !== undefined && val.result !== null) {
      return String(val.result).trim();
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
    }
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map(t => t.text).join('').trim();
    }
  }
  return String(val).trim();
}

function mapRowFields(rawRow: Record<string, string>): ParsedRosterRow | null {
  let teamName = '';
  let employeeCode = '';
  let firstName = '';
  let lastName = '';
  let email = '';
  let bmsId = '';
  let wave = '';
  let role = '';
  let supervisorCode = '';
  let weekCode = '';

  for (const [k, v] of Object.entries(rawRow)) {
    const val = v?.trim() ?? '';
    const norm = normalizeHeader(k);

    if (['equipo', 'nombre_equipo', 'team', 'team_name', 'campana', 'campana_nombre', 'campaign'].includes(norm)) {
      teamName = val;
    } else if (['codigo', 'codigo_empleado', 'code', 'id_empleado', 'cedula', 'cedula_empleado', 'documento', 'documento_identidad', 'id'].includes(norm)) {
      employeeCode = val;
    } else if (['nombre', 'nombres', 'first_name', 'firstname'].includes(norm)) {
      firstName = val;
    } else if (['apellido', 'apellidos', 'last_name', 'lastname'].includes(norm)) {
      lastName = val;
    } else if (['email', 'correo', 'correo_electronico', 'mail'].includes(norm)) {
      email = val;
    } else if (['bms_id', 'bms', 'phone_id', 'id_bms', 'login_telefonico', 'extension'].includes(norm)) {
      bmsId = val;
    } else if (['wave', 'ola', 'cohorte', 'training_wave'].includes(norm)) {
      wave = val;
    } else if (['rol', 'tipo', 'cargo', 'employee_type', 'role', 'tipo_empleado', 'posicion'].includes(norm)) {
      role = val;
    } else if (['supervisor', 'codigo_supervisor', 'sup', 'lider', 'manager', 'supervisor_code'].includes(norm)) {
      supervisorCode = val;
    } else if (['semana', 'week', 'semana_operativa', 'codigo_semana', 'week_code'].includes(norm)) {
      weekCode = val;
    }
  }

  // Row must at least have a team name or an employee code to be valid
  if (!teamName && !employeeCode) {
    return null;
  }

  return {
    teamName: teamName || 'General',
    employeeCode: employeeCode || undefined,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    email: email || undefined,
    bmsId: bmsId || undefined,
    wave: wave || undefined,
    role: role || undefined,
    supervisorCode: supervisorCode || undefined,
    weekCode: weekCode || undefined,
  };
}

function parseCsvContent(content: string): Record<string, string>[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const firstLine = lines[0]!;
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(firstLine).map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = parseLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (h) {
        row[h] = values[j] ?? '';
      }
    }
    rows.push(row);
  }
  return rows;
}

export async function parseRosterFile(buffer: Buffer, filename: string): Promise<ParsedRosterRow[]> {
  const isCsv = filename.toLowerCase().endsWith('.csv');

  if (isCsv) {
    const content = buffer.toString('utf-8');
    const records = parseCsvContent(content);

    const results: ParsedRosterRow[] = [];
    for (const rec of records) {
      const parsed = mapRowFields(rec);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  // Otherwise, treat as XLSX using ExcelJS
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  // Extract header row
  const headerRow = worksheet.getRow(1);
  const headerMap: { colIndex: number; name: string }[] = [];
  headerRow.eachCell((cell, colNumber) => {
    const val = extractCellValue(cell);
    if (val) {
      headerMap.push({ colIndex: colNumber, name: val });
    }
  });

  if (headerMap.length === 0) {
    return [];
  }

  const results: ParsedRosterRow[] = [];

  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rawObj: Record<string, string> = {};
    let hasAnyData = false;

    for (const h of headerMap) {
      const cell = row.getCell(h.colIndex);
      const val = extractCellValue(cell);
      if (val) hasAnyData = true;
      rawObj[h.name] = val;
    }

    if (hasAnyData) {
      const parsed = mapRowFields(rawObj);
      if (parsed) results.push(parsed);
    }
  }

  return results;
}

export async function generateTeamTemplateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ATLAS Operational Intelligence';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Plantilla Equipos', {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: 'Equipo', key: 'equipo', width: 22 },
    { header: 'Codigo_Empleado', key: 'codigo', width: 18 },
    { header: 'Nombres', key: 'nombre', width: 20 },
    { header: 'Apellidos', key: 'apellido', width: 20 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'BMS_ID', key: 'bms_id', width: 14 },
    { header: 'Wave', key: 'wave', width: 12 },
    { header: 'Rol', key: 'rol', width: 16 },
    { header: 'Supervisor', key: 'supervisor', width: 16 },
    { header: 'Semana_Operativa', key: 'semana', width: 18 },
  ];

  // Header style
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Example rows
  sheet.addRow({
    equipo: 'Ventas Outbound',
    codigo: 'AG-1001',
    nombre: 'Carlos',
    apellido: 'Ramirez',
    email: 'carlos.ramirez@callcenter.com',
    bms_id: 'BMS-901',
    wave: 'Wave 14',
    rol: 'Asesor',
    supervisor: 'SUP-01',
    semana: '',
  });

  sheet.addRow({
    equipo: 'Ventas Outbound',
    codigo: 'AG-1002',
    nombre: 'Laura',
    apellido: 'Gomez',
    email: 'laura.gomez@callcenter.com',
    bms_id: 'BMS-902',
    wave: 'Wave 14',
    rol: 'Asesor',
    supervisor: 'SUP-01',
    semana: '',
  });

  sheet.addRow({
    equipo: 'Ventas Outbound',
    codigo: 'SUP-01',
    nombre: 'Roberto',
    apellido: 'Silva',
    email: 'roberto.silva@callcenter.com',
    bms_id: 'BMS-801',
    wave: 'Wave 10',
    rol: 'Supervisor',
    supervisor: '',
    semana: '',
  });

  sheet.addRow({
    equipo: 'Soporte Nivel 1',
    codigo: 'AG-1003',
    nombre: 'Andres',
    apellido: 'Perez',
    email: 'andres.perez@callcenter.com',
    bms_id: 'BMS-903',
    wave: 'Wave 15',
    rol: 'Asesor',
    supervisor: 'SUP-02',
    semana: '',
  });

  sheet.addRow({
    equipo: 'Soporte Nivel 1',
    codigo: 'SUP-02',
    nombre: 'Sandra',
    apellido: 'Castro',
    email: 'sandra.castro@callcenter.com',
    bms_id: 'BMS-802',
    wave: 'Wave 12',
    rol: 'Supervisor',
    supervisor: '',
    semana: '',
  });

  sheet.addRow({
    equipo: 'Retenciones & Fidelizacion',
    codigo: '',
    nombre: '',
    apellido: '',
    email: '',
    bms_id: '',
    wave: '',
    rol: '',
    supervisor: '',
    semana: '',
  });

  // Instruction Sheet
  const infoSheet = workbook.addWorksheet('Instrucciones');
  infoSheet.columns = [
    { header: 'Columna', key: 'col', width: 22 },
    { header: 'Obligatorio', key: 'req', width: 14 },
    { header: 'Descripcion', key: 'desc', width: 60 },
  ];
  const infoHeader = infoSheet.getRow(1);
  infoHeader.height = 24;
  infoHeader.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    cell.alignment = { vertical: 'middle' };
  });

  infoSheet.addRow({ col: 'Equipo', req: 'SI', desc: 'Nombre de la campaña o equipo. Si no existe, se creará automáticamente.' });
  infoSheet.addRow({ col: 'Codigo_Empleado', req: 'OPCIONAL', desc: 'Documento, ID o código único del agente. Si se deja vacío, solo se creará el equipo.' });
  infoSheet.addRow({ col: 'Nombres', req: 'OPCIONAL', desc: 'Primer nombre del agente (se usa al registrar nuevos agentes).' });
  infoSheet.addRow({ col: 'Apellidos', req: 'OPCIONAL', desc: 'Apellidos del agente.' });
  infoSheet.addRow({ col: 'Email', req: 'OPCIONAL', desc: 'Correo corporativo del agente.' });
  infoSheet.addRow({ col: 'BMS_ID', req: 'OPCIONAL', desc: 'Identificador del sistema de telefonía / BMS para cruces de eficiencias y KPIs.' });
  infoSheet.addRow({ col: 'Wave', req: 'OPCIONAL', desc: 'Cohorte o Wave de formación.' });
  infoSheet.addRow({ col: 'Rol', req: 'OPCIONAL', desc: 'Rol (Asesor, Supervisor, etc.). Si se omite, se asigna el rol predeterminado "Agente".' });
  infoSheet.addRow({ col: 'Supervisor', req: 'OPCIONAL', desc: 'Código de empleado del supervisor asignado.' });
  infoSheet.addRow({ col: 'Semana_Operativa', req: 'OPCIONAL', desc: 'Código de semana (ej: 2026-W36). Si se deja vacío, se usa la semana elegida en el modal de carga.' });

  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.from(raw);
}
