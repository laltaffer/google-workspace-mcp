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
  return `Title: ${doc.title}\n\n[UNTRUSTED DOCUMENT CONTENT BELOW]\n${text}\n[END UNTRUSTED DOCUMENT CONTENT]`;
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

export async function deleteDoc(documentId: string): Promise<string> {
  const drive = await getDriveClient();
  await drive.files.update({ fileId: documentId, requestBody: { trashed: true } });
  return `Document ${documentId} moved to trash.`;
}

export function registerDocsTools(server: McpServer): void {
  server.registerTool('docs_get', {
    description: 'Read the full text content of a Google Doc',
    inputSchema: {
      documentId: z.string().describe('The document ID from its URL'),
    },
  }, async ({ documentId }) => {
    try {
      return { content: [{ type: 'text', text: await getDoc(documentId) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error reading document: ${msg}` }], isError: true };
    }
  });

  server.registerTool('docs_create', {
    description: 'Create a new Google Doc',
    inputSchema: {
      title: z.string().max(500).describe('Title of the new document'),
    },
  }, async ({ title }) => {
    try {
      return { content: [{ type: 'text', text: await createDoc(title) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error creating document: ${msg}` }], isError: true };
    }
  });

  server.registerTool('docs_append', {
    description: 'Append text to the end of a Google Doc',
    inputSchema: {
      documentId: z.string().describe('The document ID'),
      text: z.string().max(100000).describe('Text to append'),
    },
  }, async ({ documentId, text }) => {
    try {
      return { content: [{ type: 'text', text: await appendToDoc(documentId, text) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error appending to document: ${msg}` }], isError: true };
    }
  });

  server.registerTool('docs_replace', {
    description: 'Find and replace text in a Google Doc',
    inputSchema: {
      documentId: z.string().describe('The document ID'),
      oldText: z.string().max(10000).describe('Text to find'),
      newText: z.string().max(100000).describe('Replacement text'),
    },
  }, async ({ documentId, oldText, newText }) => {
    try {
      return { content: [{ type: 'text', text: await replaceInDoc(documentId, oldText, newText) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error replacing text: ${msg}` }], isError: true };
    }
  });

  server.registerTool('docs_delete', {
    description: 'Move a Google Doc to trash',
    inputSchema: {
      documentId: z.string().describe('The document ID to delete'),
    },
  }, async ({ documentId }) => {
    try {
      return { content: [{ type: 'text', text: await deleteDoc(documentId) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error deleting document: ${msg}` }], isError: true };
    }
  });
}
