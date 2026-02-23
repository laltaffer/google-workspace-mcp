import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { getAuthenticatedClient } from '../auth.js';
import type { docs_v1 } from 'googleapis';

async function getDocsClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.docs({ version: 'v1', auth });
}

async function getDriveClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.drive({ version: 'v3', auth });
}

function extractText(content: docs_v1.Schema$StructuralElement[]): string {
  return content
    .flatMap(el => el.paragraph?.elements ?? [])
    .map(el => el.textRun?.content ?? '')
    .join('');
}

export async function getDoc(documentId: string): Promise<string> {
  const docs = await getDocsClient();
  const res = await docs.documents.get({ documentId });
  const doc = res.data;
  const text = extractText(doc.body?.content ?? []);
  return `Title: ${doc.title}\n\n${text}`;
}

export async function createDoc(title: string): Promise<string> {
  const docs = await getDocsClient();
  const res = await docs.documents.create({ requestBody: { title } });
  return `Document created: "${res.data.title}" | id: ${res.data.documentId}`;
}

export async function appendToDoc(documentId: string, text: string): Promise<string> {
  const docs = await getDocsClient();
  const docRes = await docs.documents.get({ documentId, fields: 'body.content' });
  const content = docRes.data.body?.content ?? [];
  const endIndex = content[content.length - 1]?.endIndex ?? 1;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{ insertText: { location: { index: endIndex - 1 }, text } }],
    },
  });
  return `Text appended to document ${documentId}.`;
}

export async function replaceInDoc(
  documentId: string,
  oldText: string,
  newText: string
): Promise<string> {
  const docs = await getDocsClient();
  const res = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{
        replaceAllText: {
          containsText: { text: oldText, matchCase: true },
          replaceText: newText,
        },
      }],
    },
  });
  const changed = res.data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
  return `Replaced ${changed} occurrence(s) of "${oldText}" with "${newText}".`;
}

export async function batchUpdateDoc(
  documentId: string,
  requests: object[]
): Promise<string> {
  const docs = await getDocsClient();
  await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
  return `Batch update applied to document ${documentId}.`;
}

export async function deleteDoc(documentId: string): Promise<string> {
  const drive = await getDriveClient();
  await drive.files.delete({ fileId: documentId });
  return `Document ${documentId} moved to trash.`;
}

export function registerDocsTools(server: McpServer): void {
  server.registerTool('docs_get', {
    description: 'Read the full text content of a Google Doc',
    inputSchema: {
      documentId: z.string().describe('The document ID from its URL'),
    },
  }, async ({ documentId }) => ({
    content: [{ type: 'text', text: await getDoc(documentId) }],
  }));

  server.registerTool('docs_create', {
    description: 'Create a new Google Doc',
    inputSchema: {
      title: z.string().describe('Title of the new document'),
    },
  }, async ({ title }) => ({
    content: [{ type: 'text', text: await createDoc(title) }],
  }));

  server.registerTool('docs_append', {
    description: 'Append text to the end of a Google Doc',
    inputSchema: {
      documentId: z.string().describe('The document ID'),
      text: z.string().describe('Text to append'),
    },
  }, async ({ documentId, text }) => ({
    content: [{ type: 'text', text: await appendToDoc(documentId, text) }],
  }));

  server.registerTool('docs_replace', {
    description: 'Find and replace text in a Google Doc',
    inputSchema: {
      documentId: z.string().describe('The document ID'),
      oldText: z.string().describe('Text to find'),
      newText: z.string().describe('Replacement text'),
    },
  }, async ({ documentId, oldText, newText }) => ({
    content: [{ type: 'text', text: await replaceInDoc(documentId, oldText, newText) }],
  }));

  server.registerTool('docs_batch_update', {
    description: 'Apply raw Google Docs API batchUpdate requests (for advanced edits)',
    inputSchema: {
      documentId: z.string().describe('The document ID'),
      requests: z.array(z.record(z.unknown())).describe('Array of Google Docs API request objects'),
    },
  }, async ({ documentId, requests }) => ({
    content: [{ type: 'text', text: await batchUpdateDoc(documentId, requests) }],
  }));

  server.registerTool('docs_delete', {
    description: 'Move a Google Doc to trash',
    inputSchema: {
      documentId: z.string().describe('The document ID to delete'),
    },
  }, async ({ documentId }) => ({
    content: [{ type: 'text', text: await deleteDoc(documentId) }],
  }));
}
