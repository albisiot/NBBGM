import { describe, expect, it } from 'vitest';
import { sheetLinksForExcelJs } from '../src/import/excel.ts';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

describe('sheetLinksForExcelJs', () => {
  it('rende relativi i collegamenti di openpyxl e toglie le note che ExcelJS non trova', () => {
    const xml =
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Type="${REL}/table" Target="/xl/tables/table1.xml" Id="rId1"/>` +
      `<Relationship Type="${REL}/comments" Target="/xl/comments/comment1.xml" Id="comments"/>` +
      `<Relationship Type="${REL}/vmlDrawing" Target="/xl/drawings/commentsDrawing1.vml" Id="anysvml"/>` +
      `</Relationships>`;
    expect(sheetLinksForExcelJs(xml)).toBe(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Type="${REL}/table" Target="../tables/table1.xml" Id="rId1"/>` +
        `</Relationships>`,
    );
  });

  it('lascia com’è un file salvato da Excel', () => {
    const xml =
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId2" Type="${REL}/comments" Target="../comments1.xml"/>` +
      `<Relationship Id="rId1" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>` +
      `</Relationships>`;
    expect(sheetLinksForExcelJs(xml)).toBe(xml);
  });
});
