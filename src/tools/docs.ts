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

const HEADING_LEVEL: Record<string, number> = {
  TITLE: 1, HEADING_1: 1, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6,
};

function renderParagraph(p: docs_v1.Schema$Paragraph): string {
  const text = (p.elements ?? [])
    .map(el => {
      const run = el.textRun;
      if (!run?.content) return '';
      const url = run.textStyle?.link?.url;
      if (!url) return run.content;
      // Keep a trailing newline outside the link so the line still terminates.
      const body = run.content.replace(/\n$/, '');
      return `[${body}](${url})${run.content.endsWith('\n') ? '\n' : ''}`;
    })
    .join('');
  const level = HEADING_LEVEL[p.paragraphStyle?.namedStyleType ?? ''];
  if (level) return `${'#'.repeat(level)} ${text}`;
  if (p.bullet) return `${'  '.repeat(p.bullet.nestingLevel ?? 0)}- ${text}`;
  return text;
}

function renderTable(t: docs_v1.Schema$Table, includeIndices: boolean): string {
  const rows = (t.tableRows ?? []).map(r =>
    (r.tableCells ?? []).map(c =>
      extractText(c.content ?? [], includeIndices).replace(/\n+$/, '').replace(/\n/g, ' ').replace(/\|/g, '\\|'),
    ),
  );
  if (rows.length === 0) return '';
  const line = (cells: string[]) => `| ${cells.join(' | ')} |\n`;
  const sep = `| ${rows[0].map(() => '---').join(' | ')} |\n`;
  return line(rows[0]) + sep + rows.slice(1).map(line).join('');
}

// Renders the document body as markdown: headings, bullets (nested by
// indentation), links, and tables. With includeIndices, each block is
// prefixed with its startIndex ([@n]) so a caller can target batchUpdate
// requests. Indices shift after every write, so re-read before editing.
export function extractText(
  content: docs_v1.Schema$StructuralElement[],
  includeIndices = false,
): string {
  return content
    .map(el => {
      let out = '';
      if (el.paragraph) out = renderParagraph(el.paragraph);
      else if (el.table) out = renderTable(el.table, includeIndices);
      if (!out) return '';
      return includeIndices && el.startIndex != null ? `[@${el.startIndex}] ${out}` : out;
    })
    .join('');
}

export async function getDoc(documentId: string, includeIndices = false): Promise<string> {
  const docs = await getDocsClient();
  const res = await docs.documents.get({ documentId });
  const doc = res.data;
  const text = extractText(doc.body?.content ?? [], includeIndices);
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

export async function batchUpdateDoc(
  documentId: string,
  requests: docs_v1.Schema$Request[],
): Promise<string> {
  const docs = await getDocsClient();
  const res = await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
  const replies = (res.data.replies ?? []).filter(r => Object.keys(r).length > 0);
  const detail = replies.length ? `\nReplies: ${JSON.stringify(replies)}` : '';
  return `${requests.length} request(s) applied to document ${documentId}.${detail}`;
}

export async function deleteDoc(documentId: string): Promise<string> {
  const drive = await getDriveClient();
  await drive.files.update({ fileId: documentId, requestBody: { trashed: true } });
  return `Document ${documentId} moved to trash.`;
}

export function registerDocsTools(server: McpServer): void {
  server.registerTool('docs_get', {
    description: 'Read a Google Doc as markdown: headings, bullets, links, and tables are preserved. Set includeIndices to prefix each block with its start index ([@n]) for use with docs_batch_update.',
    inputSchema: {
      documentId: z.string().describe('The document ID from its URL'),
      includeIndices: z.boolean().optional().describe('Prefix each block with its startIndex for targeting edits'),
    },
  }, async ({ documentId, includeIndices }) => {
    try {
      return { content: [{ type: 'text', text: await getDoc(documentId, includeIndices ?? false) }] };
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

  server.registerTool('docs_batch_update', {
    description: 'Apply raw Google Docs API batchUpdate requests (insertText, updateParagraphStyle, createParagraphBullets, insertTable, updateTextStyle, etc.) for formatting and structured edits. Read the doc with docs_get includeIndices=true first: indices shift after every write, so apply requests in descending index order or re-read between calls.',
    inputSchema: {
      documentId: z.string().describe('The document ID'),
      requests: z.array(z.record(z.unknown())).min(1).max(200).describe('Array of Docs API Request objects, applied in order'),
    },
  }, async ({ documentId, requests }) => {
    try {
      return { content: [{ type: 'text', text: await batchUpdateDoc(documentId, requests as docs_v1.Schema$Request[]) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error applying batch update: ${msg}` }], isError: true };
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
