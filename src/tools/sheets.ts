import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { getAuthenticatedClient } from '../auth.js';

async function getSheetsClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.sheets({ version: 'v4', auth });
}

async function getDriveClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.drive({ version: 'v3', auth });
}

export async function getSheetValues(spreadsheetId: string, range: string): Promise<string> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values;
  if (!rows || rows.length === 0) return 'No data found in that range.';
  return `[UNTRUSTED SPREADSHEET CONTENT BELOW]\n${rows.map(row => row.join('\t')).join('\n')}\n[END UNTRUSTED SPREADSHEET CONTENT]`;
}

export async function createSpreadsheet(title: string): Promise<string> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
    fields: 'spreadsheetId,properties.title',
  });
  return `Spreadsheet created: "${res.data.properties?.title}" | id: ${res.data.spreadsheetId}`;
}

export async function updateSheetValues(
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<string> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  return `Updated ${res.data.updatedCells} cell(s) in range ${range}.`;
}

export async function appendSheetRows(
  spreadsheetId: string,
  sheetName: string,
  values: string[][]
): Promise<string> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  const updated = res.data.updates?.updatedRows ?? 0;
  return `Appended ${updated} row(s) to ${sheetName}.`;
}

export async function clearSheetRange(spreadsheetId: string, range: string): Promise<string> {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  return `Cleared range ${range} in spreadsheet ${spreadsheetId}.`;
}

export async function deleteSpreadsheet(spreadsheetId: string): Promise<string> {
  const drive = await getDriveClient();
  await drive.files.update({ fileId: spreadsheetId, requestBody: { trashed: true } });
  return `Spreadsheet ${spreadsheetId} moved to trash.`;
}

export function registerSheetsTools(server: McpServer): void {
  server.registerTool('sheets_get', {
    description: 'Read cell values from a Google Sheet range',
    inputSchema: {
      spreadsheetId: z.string().describe('The spreadsheet ID from its URL'),
      range: z.string().describe('A1 notation range, e.g. "Sheet1!A1:C10"'),
    },
  }, async ({ spreadsheetId, range }) => {
    try {
      return { content: [{ type: 'text', text: await getSheetValues(spreadsheetId, range) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error reading sheet: ${msg}` }], isError: true };
    }
  });

  server.registerTool('sheets_create', {
    description: 'Create a new Google Spreadsheet',
    inputSchema: {
      title: z.string().max(500).describe('Title of the new spreadsheet'),
    },
  }, async ({ title }) => {
    try {
      return { content: [{ type: 'text', text: await createSpreadsheet(title) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error creating spreadsheet: ${msg}` }], isError: true };
    }
  });

  server.registerTool('sheets_update', {
    description: 'Write values to a range in a Google Sheet',
    inputSchema: {
      spreadsheetId: z.string().describe('The spreadsheet ID'),
      range: z.string().describe('A1 notation range to write to'),
      values: z.array(z.array(z.string())).describe('2D array of values to write'),
    },
  }, async ({ spreadsheetId, range, values }) => {
    try {
      return { content: [{ type: 'text', text: await updateSheetValues(spreadsheetId, range, values) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error updating sheet: ${msg}` }], isError: true };
    }
  });

  server.registerTool('sheets_append', {
    description: 'Append rows to the end of a Google Sheet',
    inputSchema: {
      spreadsheetId: z.string().describe('The spreadsheet ID'),
      sheetName: z.string().describe('Name of the sheet tab to append to'),
      values: z.array(z.array(z.string())).describe('2D array of rows to append'),
    },
  }, async ({ spreadsheetId, sheetName, values }) => {
    try {
      return { content: [{ type: 'text', text: await appendSheetRows(spreadsheetId, sheetName, values) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error appending rows: ${msg}` }], isError: true };
    }
  });

  server.registerTool('sheets_clear', {
    description: 'Clear all values in a range of a Google Sheet',
    inputSchema: {
      spreadsheetId: z.string().describe('The spreadsheet ID'),
      range: z.string().describe('A1 notation range to clear'),
    },
  }, async ({ spreadsheetId, range }) => {
    try {
      return { content: [{ type: 'text', text: await clearSheetRange(spreadsheetId, range) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error clearing range: ${msg}` }], isError: true };
    }
  });

  server.registerTool('sheets_delete', {
    description: 'Move a Google Spreadsheet to trash',
    inputSchema: {
      spreadsheetId: z.string().describe('The spreadsheet ID to delete'),
    },
  }, async ({ spreadsheetId }) => {
    try {
      return { content: [{ type: 'text', text: await deleteSpreadsheet(spreadsheetId) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error deleting spreadsheet: ${msg}` }], isError: true };
    }
  });
}
