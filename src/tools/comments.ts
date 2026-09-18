import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { getAuthenticatedClient } from '../auth.js';
import type { drive_v3 } from 'googleapis';

// Comments live in the Drive API regardless of file type, so these tools work
// on Docs, Sheets, and Slides alike.

const COMMENT_FIELDS =
  'id,author(displayName),createdTime,modifiedTime,content,quotedFileContent(value),resolved,deleted,' +
  'replies(id,author(displayName),createdTime,content,action,deleted)';

async function getDriveClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.drive({ version: 'v3', auth });
}

function formatReply(r: drive_v3.Schema$Reply): string {
  const who = r.author?.displayName ?? 'Unknown';
  const action = r.action ? ` [${r.action}]` : '';
  const body = r.deleted ? '(deleted)' : (r.content ?? '');
  return `    ↳ ${who} | ${r.createdTime}${action} | reply id: ${r.id}\n      ${body}`;
}

function formatComment(c: drive_v3.Schema$Comment): string {
  const who = c.author?.displayName ?? 'Unknown';
  const status = c.resolved ? 'RESOLVED' : 'OPEN';
  const lines = [`${who} | ${c.createdTime} | ${status} | id: ${c.id}`];
  if (c.quotedFileContent?.value) lines.push(`  On: "${c.quotedFileContent.value}"`);
  lines.push(`  ${c.deleted ? '(deleted)' : (c.content ?? '')}`);
  for (const r of c.replies ?? []) lines.push(formatReply(r));
  return lines.join('\n');
}

export async function listComments(fileId: string, includeResolved = false, pageSize = 20): Promise<string> {
  const drive = await getDriveClient();
  const clampedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const res = await drive.comments.list({
    fileId,
    pageSize: clampedPageSize,
    fields: `nextPageToken,comments(${COMMENT_FIELDS})`,
  });
  const all = res.data.comments ?? [];
  const comments = includeResolved ? all : all.filter(c => !c.resolved);
  if (comments.length === 0) {
    return includeResolved ? 'No comments found.' : 'No open comments found. (Pass includeResolved to see resolved ones.)';
  }
  const hidden = all.length - comments.length;
  const footer = [
    hidden > 0 ? `${hidden} resolved comment(s) hidden.` : '',
    res.data.nextPageToken ? 'More comments exist beyond this page; raise pageSize to see them.' : '',
  ].filter(Boolean).join(' ');
  const body = comments.map(formatComment).join('\n\n');
  return `[UNTRUSTED COMMENT CONTENT BELOW]\n${body}\n[END UNTRUSTED COMMENT CONTENT]${footer ? `\n${footer}` : ''}`;
}

export async function getComment(fileId: string, commentId: string): Promise<string> {
  const drive = await getDriveClient();
  const res = await drive.comments.get({ fileId, commentId, fields: COMMENT_FIELDS });
  return `[UNTRUSTED COMMENT CONTENT BELOW]\n${formatComment(res.data)}\n[END UNTRUSTED COMMENT CONTENT]`;
}

export async function replyToComment(
  fileId: string,
  commentId: string,
  content: string,
  resolve = false,
): Promise<string> {
  const drive = await getDriveClient();
  const res = await drive.replies.create({
    fileId,
    commentId,
    fields: 'id',
    requestBody: { content, action: resolve ? 'resolve' : undefined },
  });
  return `Reply posted${resolve ? ' and comment resolved' : ''} | reply id: ${res.data.id}`;
}

export function registerCommentsTools(server: McpServer): void {
  server.registerTool('comments_list', {
    description: 'List comments (with their replies) on a Google Doc, Sheet, or Slides file. Shows open comments by default.',
    inputSchema: {
      fileId: z.string().describe('The file ID (document, spreadsheet, or presentation)'),
      includeResolved: z.boolean().optional().describe('Also show resolved comments (default false)'),
      pageSize: z.number().int().min(1).max(100).optional().describe('Max comments to fetch (default 20, max 100)'),
    },
  }, async ({ fileId, includeResolved, pageSize }) => {
    try {
      return { content: [{ type: 'text', text: await listComments(fileId, includeResolved, pageSize) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error listing comments: ${msg}` }], isError: true };
    }
  });

  server.registerTool('comments_get', {
    description: 'Get a single comment and its full reply thread',
    inputSchema: {
      fileId: z.string().describe('The file ID'),
      commentId: z.string().describe('The comment ID (from comments_list)'),
    },
  }, async ({ fileId, commentId }) => {
    try {
      return { content: [{ type: 'text', text: await getComment(fileId, commentId) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error getting comment: ${msg}` }], isError: true };
    }
  });

  server.registerTool('comments_reply', {
    description: 'Reply to a comment, optionally resolving it',
    inputSchema: {
      fileId: z.string().describe('The file ID'),
      commentId: z.string().describe('The comment ID to reply to'),
      content: z.string().max(10000).describe('Plain text of the reply'),
      resolve: z.boolean().optional().describe('Also mark the comment resolved (default false)'),
    },
  }, async ({ fileId, commentId, content, resolve }) => {
    try {
      return { content: [{ type: 'text', text: await replyToComment(fileId, commentId, content, resolve) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error replying to comment: ${msg}` }], isError: true };
    }
  });
}
