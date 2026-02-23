import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { getAuthenticatedClient } from '../auth.js';

async function getDriveClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.drive({ version: 'v3', auth });
}

export async function listFiles(folderId?: string, pageSize = 20): Promise<string> {
  const drive = await getDriveClient();
  const q = folderId
    ? `'${folderId}' in parents and trashed = false`
    : 'trashed = false';
  const res = await drive.files.list({
    q,
    pageSize,
    fields: 'files(id,name,mimeType,modifiedTime)',
  });
  const files = res.data.files ?? [];
  if (files.length === 0) return 'No files found.';
  return files.map(f => `${f.name} | id: ${f.id} | type: ${f.mimeType}`).join('\n');
}

export async function searchFiles(query: string, pageSize = 20): Promise<string> {
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: `name contains '${query}' and trashed = false`,
    pageSize,
    fields: 'files(id,name,mimeType,modifiedTime)',
  });
  const files = res.data.files ?? [];
  if (files.length === 0) return 'No files found matching that query.';
  return files.map(f => `${f.name} | id: ${f.id} | type: ${f.mimeType}`).join('\n');
}

export async function getFile(fileId: string): Promise<string> {
  const drive = await getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,modifiedTime,size,parents',
  });
  const f = res.data;
  return `Name: ${f.name}\nID: ${f.id}\nType: ${f.mimeType}\nModified: ${f.modifiedTime}\nParents: ${f.parents?.join(', ')}`;
}

export async function createFolder(name: string, parentId?: string): Promise<string> {
  const drive = await getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id,name',
  });
  return `Folder created: ${res.data.name} | id: ${res.data.id}`;
}

export async function moveFile(fileId: string, newParentId: string): Promise<string> {
  const drive = await getDriveClient();
  const existing = await drive.files.get({ fileId, fields: 'parents' });
  const previousParents = existing.data.parents?.join(',') ?? '';
  await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: previousParents,
    fields: 'id,name,parents',
  });
  return `File ${fileId} moved to folder ${newParentId}`;
}

export async function deleteFile(fileId: string): Promise<string> {
  const drive = await getDriveClient();
  await drive.files.delete({ fileId });
  return `File ${fileId} moved to trash.`;
}

export function registerDriveTools(server: McpServer): void {
  server.registerTool('drive_list', {
    description: 'List files and folders in Google Drive',
    inputSchema: {
      folderId: z.string().optional().describe('Folder ID to list (defaults to all files)'),
      pageSize: z.number().optional().describe('Max results to return (default 20)'),
    },
  }, async ({ folderId, pageSize }) => ({
    content: [{ type: 'text', text: await listFiles(folderId, pageSize) }],
  }));

  server.registerTool('drive_search', {
    description: 'Search for files in Google Drive by name',
    inputSchema: {
      query: z.string().describe('Search term to match against file names'),
      pageSize: z.number().optional().describe('Max results (default 20)'),
    },
  }, async ({ query, pageSize }) => ({
    content: [{ type: 'text', text: await searchFiles(query, pageSize) }],
  }));

  server.registerTool('drive_get', {
    description: 'Get metadata for a specific file or folder',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID'),
    },
  }, async ({ fileId }) => ({
    content: [{ type: 'text', text: await getFile(fileId) }],
  }));

  server.registerTool('drive_create_folder', {
    description: 'Create a new folder in Google Drive',
    inputSchema: {
      name: z.string().describe('Name of the folder to create'),
      parentId: z.string().optional().describe('Parent folder ID (defaults to root)'),
    },
  }, async ({ name, parentId }) => ({
    content: [{ type: 'text', text: await createFolder(name, parentId) }],
  }));

  server.registerTool('drive_move', {
    description: 'Move a file or folder to a different parent folder',
    inputSchema: {
      fileId: z.string().describe('ID of the file to move'),
      newParentId: z.string().describe('ID of the destination folder'),
    },
  }, async ({ fileId, newParentId }) => ({
    content: [{ type: 'text', text: await moveFile(fileId, newParentId) }],
  }));

  server.registerTool('drive_delete', {
    description: 'Move a file or folder to trash',
    inputSchema: {
      fileId: z.string().describe('ID of the file to delete'),
    },
  }, async ({ fileId }) => ({
    content: [{ type: 'text', text: await deleteFile(fileId) }],
  }));
}
