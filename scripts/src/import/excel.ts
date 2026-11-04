import ExcelJS from 'exceljs';
import type { Cell, Row } from './parse.ts';

/** Valore semplice di una cella: testo, numero o null (formule e link compresi). */
function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result as ExcelJS.CellValue);
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
  }
  return null;
}

export interface SheetData {
  header: string[];
  rows: Row[];
}

/** Legge un foglio con l'intestazione alla riga headerRow; le righe dati seguono. */
export function readSheet(workbook: ExcelJS.Workbook, name: string, headerRow: number): SheetData {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Foglio "${name}" non trovato`);
  const width = sheet.columnCount;
  const read = (r: number): Row => {
    const row = sheet.getRow(r);
    return Array.from({ length: width }, (_, c) => cellValue(row.getCell(c + 1).value));
  };
  const header = read(headerRow).map((v) => (v === null ? '' : String(v).trim()));
  const rows: Row[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) rows.push(read(r));
  return { header, rows };
}

export async function openWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}
