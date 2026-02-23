import { google } from 'googleapis';
import { z } from 'zod';
import { getAuthenticatedClient } from '../auth.js';
async function getSheetsClient() {
    const auth = await getAuthenticatedClient();
    if (!auth)
        throw new Error('Not authenticated. Call the authorize tool first.');
    return google.sheets({ version: 'v4', auth });
}
async function getDriveClient() {
    const auth = await getAuthenticatedClient();
    if (!auth)
        throw new Error('Not authenticated. Call the authorize tool first.');
    return google.drive({ version: 'v3', auth });
}
export async function getSheetValues(spreadsheetId, range) {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values;
    if (!rows || rows.length === 0)
        return 'No data found in that range.';
    return rows.map(row => row.join('\t')).join('\n');
}
export async function createSpreadsheet(title) {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.create({
        requestBody: { properties: { title } },
        fields: 'spreadsheetId,properties.title',
    });
    return `Spreadsheet created: "${res.data.properties?.title}" | id: ${res.data.spreadsheetId}`;
}
export async function updateSheetValues(spreadsheetId, range, values) {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
    });
    return `Updated ${res.data.updatedCells} cell(s) in range ${range}.`;
}
export async function appendSheetRows(spreadsheetId, sheetName, values) {
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
export async function clearSheetRange(spreadsheetId, range) {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.clear({ spreadsheetId, range });
    return `Cleared range ${range} in spreadsheet ${spreadsheetId}.`;
}
export async function deleteSpreadsheet(spreadsheetId) {
    const drive = await getDriveClient();
    await drive.files.delete({ fileId: spreadsheetId });
    return `Spreadsheet ${spreadsheetId} moved to trash.`;
}
export function registerSheetsTools(server) {
    server.registerTool('sheets_get', {
        description: 'Read cell values from a Google Sheet range',
        inputSchema: {
            spreadsheetId: z.string().describe('The spreadsheet ID from its URL'),
            range: z.string().describe('A1 notation range, e.g. "Sheet1!A1:C10"'),
        },
    }, async ({ spreadsheetId, range }) => ({
        content: [{ type: 'text', text: await getSheetValues(spreadsheetId, range) }],
    }));
    server.registerTool('sheets_create', {
        description: 'Create a new Google Spreadsheet',
        inputSchema: {
            title: z.string().describe('Title of the new spreadsheet'),
        },
    }, async ({ title }) => ({
        content: [{ type: 'text', text: await createSpreadsheet(title) }],
    }));
    server.registerTool('sheets_update', {
        description: 'Write values to a range in a Google Sheet',
        inputSchema: {
            spreadsheetId: z.string().describe('The spreadsheet ID'),
            range: z.string().describe('A1 notation range to write to'),
            values: z.array(z.array(z.string())).describe('2D array of values to write'),
        },
    }, async ({ spreadsheetId, range, values }) => ({
        content: [{ type: 'text', text: await updateSheetValues(spreadsheetId, range, values) }],
    }));
    server.registerTool('sheets_append', {
        description: 'Append rows to the end of a Google Sheet',
        inputSchema: {
            spreadsheetId: z.string().describe('The spreadsheet ID'),
            sheetName: z.string().describe('Name of the sheet tab to append to'),
            values: z.array(z.array(z.string())).describe('2D array of rows to append'),
        },
    }, async ({ spreadsheetId, sheetName, values }) => ({
        content: [{ type: 'text', text: await appendSheetRows(spreadsheetId, sheetName, values) }],
    }));
    server.registerTool('sheets_clear', {
        description: 'Clear all values in a range of a Google Sheet',
        inputSchema: {
            spreadsheetId: z.string().describe('The spreadsheet ID'),
            range: z.string().describe('A1 notation range to clear'),
        },
    }, async ({ spreadsheetId, range }) => ({
        content: [{ type: 'text', text: await clearSheetRange(spreadsheetId, range) }],
    }));
    server.registerTool('sheets_delete', {
        description: 'Move a Google Spreadsheet to trash',
        inputSchema: {
            spreadsheetId: z.string().describe('The spreadsheet ID to delete'),
        },
    }, async ({ spreadsheetId }) => ({
        content: [{ type: 'text', text: await deleteSpreadsheet(spreadsheetId) }],
    }));
}
