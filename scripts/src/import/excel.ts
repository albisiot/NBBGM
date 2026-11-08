import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
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

const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const VML_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing';

/**
 * Collegamenti dei fogli che ExcelJS sa leggere. I file salvati da openpyxl (come il v4 dei giocatori) scrivono
 * percorsi assoluti ("/xl/tables/table1.xml") e note in "xl/comments/comment1.xml": ExcelJS cerca i collegamenti
 * con il percorso relativo e le note solo in "xl/comments1.xml", e si ferma. I percorsi diventano relativi e i
 * collegamenti alle note che ExcelJS non trova si tolgono: l'import legge solo i valori delle celle.
 */
export function sheetLinksForExcelJs(xml: string): string {
  return xml.replace(/Target="\/xl\//g, 'Target="../').replace(/<Relationship\b[^>]*\/>/g, (rel) => {
    const target = /Target="([^"]*)"/.exec(rel)?.[1] ?? '';
    if (rel.includes(`"${COMMENTS_REL}"`) && !/^\.\.\/comments\d+\.xml$/.test(target)) return '';
    if (rel.includes(`"${VML_REL}"`) && !/^\.\.\/drawings\/vmlDrawing\d+\.vml$/.test(target)) return '';
    return rel;
  });
}

async function readableByExcelJs(data: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(name)) continue;
    const xml = await zip.file(name)!.async('string');
    const fixed = sheetLinksForExcelJs(xml);
    if (fixed !== xml) {
      zip.file(name, fixed);
      changed = true;
    }
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer' }) : data;
}

export async function openWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const data = await readableByExcelJs(await readFile(path));
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  return workbook;
}
