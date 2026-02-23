import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockValuesGet = vi.fn();
const mockValuesUpdate = vi.fn();
const mockValuesAppend = vi.fn();
const mockValuesClear = vi.fn();
const mockSpreadsheetsCreate = vi.fn();
const mockFilesUpdate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn().mockReturnValue({
      spreadsheets: {
        create: mockSpreadsheetsCreate,
        values: {
          get: mockValuesGet,
          update: mockValuesUpdate,
          append: mockValuesAppend,
          clear: mockValuesClear,
        },
      },
    }),
    drive: vi.fn().mockReturnValue({
      files: { update: mockFilesUpdate },
    }),
  },
}));

vi.mock('../../src/auth.js', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({}),
}));

const { getSheetValues, createSpreadsheet, updateSheetValues, appendSheetRows, clearSheetRange } =
  await import('../../src/tools/sheets.js');

describe('sheets tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSheetValues returns formatted cell data', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: [['Name', 'Age'], ['Alice', '30']] } });
    const result = await getSheetValues('sheet-1', 'Sheet1!A1:B2');
    expect(result).toContain('Name');
    expect(result).toContain('Alice');
  });

  it('getSheetValues returns empty message when no data', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: undefined } });
    const result = await getSheetValues('sheet-1', 'A1:B2');
    expect(result).toContain('No data');
  });

  it('createSpreadsheet returns new sheet id and title', async () => {
    mockSpreadsheetsCreate.mockResolvedValue({
      data: { spreadsheetId: 'sp-1', properties: { title: 'Budget 2026' } },
    });
    const result = await createSpreadsheet('Budget 2026');
    expect(result).toContain('sp-1');
    expect(result).toContain('Budget 2026');
  });

  it('updateSheetValues calls sheets API with correct values', async () => {
    mockValuesUpdate.mockResolvedValue({ data: { updatedCells: 4 } });
    const result = await updateSheetValues('sheet-1', 'A1:B2', [['a', 'b'], ['c', 'd']]);
    expect(mockValuesUpdate).toHaveBeenCalled();
    expect(result).toContain('4');
  });

  it('appendSheetRows appends rows to sheet', async () => {
    mockValuesAppend.mockResolvedValue({ data: { updates: { updatedRows: 2 } } });
    const result = await appendSheetRows('sheet-1', 'Sheet1', [['x', 'y']]);
    expect(result).toContain('2');
  });
});
