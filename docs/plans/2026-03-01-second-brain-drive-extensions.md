# Second Brain Drive Extensions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 new Drive tools (rename, get_tree, copy, upload, star, list_starred) and modify 2 existing create tools (docs_create, sheets_create) to accept a parentFolderId, enabling Claude to serve as a second brain via Google Drive.

**Architecture:** All new tools follow the existing pattern — exported business logic functions + `registerDriveTools` registration. The 6 new tools go in `src/tools/drive.ts`. The 2 modified tools are in `src/tools/docs.ts` and `src/tools/sheets.ts`. Tests mirror existing mock pattern.

**Tech Stack:** TypeScript, googleapis (Drive API v3), zod, vitest, @modelcontextprotocol/sdk

---

### Task 1: Add `renameFile` — Test

**Files:**
- Modify: `tests/tools/drive.test.ts`

**Step 1: Write the failing test**

Add to `tests/tools/drive.test.ts` — add `renameFile` to the import on line 27, then add this test inside the `describe` block:

```typescript
it('renameFile returns updated name', async () => {
  mockFilesUpdate.mockResolvedValue({
    data: { id: 'file-1', name: 'New Name', mimeType: 'application/vnd.google-apps.document' },
  });
  const result = await renameFile('file-1', 'New Name');
  expect(result).toContain('New Name');
  expect(result).toContain('file-1');
  expect(mockFilesUpdate).toHaveBeenCalledWith({
    fileId: 'file-1',
    requestBody: { name: 'New Name' },
    fields: 'id,name,mimeType',
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: FAIL — `renameFile` is not exported

---

### Task 2: Add `renameFile` — Implementation

**Files:**
- Modify: `src/tools/drive.ts`

**Step 1: Add business logic function**

Add after the `deleteFile` function (after line 87):

```typescript
export async function renameFile(fileId: string, name: string): Promise<string> {
  const drive = await getDriveClient();
  const res = await drive.files.update({
    fileId,
    requestBody: { name },
    fields: 'id,name,mimeType',
  });
  return `Renamed to: ${res.data.name} | id: ${res.data.id} | type: ${res.data.mimeType}`;
}
```

**Step 2: Register the tool**

Add inside `registerDriveTools`, after the `drive_delete` registration (after line 176):

```typescript
server.registerTool('drive_rename', {
  description: 'Rename a file or folder in Google Drive',
  inputSchema: {
    fileId: z.string().regex(FILE_ID_PATTERN).describe('ID of the file or folder to rename'),
    name: z.string().max(500).describe('New name for the file or folder'),
  },
}, async ({ fileId, name }) => {
  try {
    return { content: [{ type: 'text', text: await renameFile(fileId, name) }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error renaming file: ${msg}` }], isError: true };
  }
});
```

**Step 3: Run test to verify it passes**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add src/tools/drive.ts tests/tools/drive.test.ts
git commit -m "feat: add drive_rename tool"
```

---

### Task 3: Add `getTree` — Test

**Files:**
- Modify: `tests/tools/drive.test.ts`

**Step 1: Write the failing tests**

Add `getTree` to the import on line 27. Add these tests inside the `describe` block:

```typescript
it('getTree returns folder hierarchy', async () => {
  // First call: list children of root folder
  mockFilesList.mockResolvedValueOnce({
    data: {
      files: [
        { id: 'sub-1', name: 'Projects', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'file-1', name: 'readme.txt', mimeType: 'text/plain' },
      ],
    },
  });
  // Second call: list children of sub-1 (Projects)
  mockFilesList.mockResolvedValueOnce({
    data: { files: [] },
  });
  const result = await getTree('root-1', 2);
  expect(result).toContain('Projects');
  expect(result).toContain('readme.txt');
});

it('getTree respects depth limit', async () => {
  mockFilesList.mockResolvedValue({
    data: {
      files: [
        { id: 'deep', name: 'Deep', mimeType: 'application/vnd.google-apps.folder' },
      ],
    },
  });
  const result = await getTree('root-1', 1);
  // At depth 1, we list root's children but don't recurse into them
  expect(mockFilesList).toHaveBeenCalledTimes(1);
  expect(result).toContain('Deep');
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: FAIL — `getTree` is not exported

---

### Task 4: Add `getTree` — Implementation

**Files:**
- Modify: `src/tools/drive.ts`

**Step 1: Add business logic function**

Add after the `renameFile` function:

```typescript
export async function getTree(folderId?: string, depth = 3): Promise<string> {
  const drive = await getDriveClient();
  const clampedDepth = Math.min(Math.max(depth, 1), 5);
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  async function walk(parentId: string, currentDepth: number, indent: string): Promise<string[]> {
    if (currentDepth <= 0) return [`${indent}...`];
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      pageSize: 100,
      fields: 'files(id,name,mimeType)',
      orderBy: 'folder,name',
    });
    const files = res.data.files ?? [];
    if (files.length === 0) return [`${indent}(empty)`];
    const lines: string[] = [];
    for (const f of files) {
      if (f.mimeType === FOLDER_MIME) {
        lines.push(`${indent}📁 ${f.name}/`);
        const children = await walk(f.id!, currentDepth - 1, indent + '  ');
        lines.push(...children);
      } else {
        lines.push(`${indent}📄 ${f.name}`);
      }
    }
    return lines;
  }

  const rootId = folderId ?? 'root';
  const lines = await walk(rootId, clampedDepth, '');
  return lines.join('\n');
}
```

**Step 2: Register the tool**

Add inside `registerDriveTools`, after `drive_rename`:

```typescript
server.registerTool('drive_get_tree', {
  description: 'Get the folder hierarchy of a Google Drive folder as a tree view',
  inputSchema: {
    folderId: z.string().regex(FILE_ID_PATTERN).optional().describe('Root folder ID (defaults to Drive root)'),
    depth: z.number().int().min(1).max(5).optional().describe('Max depth to recurse (default 3, max 5)'),
  },
}, async ({ folderId, depth }) => {
  try {
    return { content: [{ type: 'text', text: await getTree(folderId, depth) }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error getting tree: ${msg}` }], isError: true };
  }
});
```

**Step 3: Run test to verify it passes**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add src/tools/drive.ts tests/tools/drive.test.ts
git commit -m "feat: add drive_get_tree tool for recursive folder hierarchy"
```

---

### Task 5: Add `copyFile` — Test

**Files:**
- Modify: `tests/tools/drive.test.ts`

**Step 1: Write the failing test**

Add a `mockFilesCopy` mock at the top alongside the others:

```typescript
const mockFilesCopy = vi.fn();
```

Add `copy` to the mock drive object:

```typescript
copy: mockFilesCopy,
```

Add `copyFile` to the import. Add this test:

```typescript
it('copyFile returns new file metadata', async () => {
  mockFilesCopy.mockResolvedValue({
    data: { id: 'copy-1', name: 'Copy of Budget', mimeType: 'application/vnd.google-apps.spreadsheet' },
  });
  const result = await copyFile('file-1', 'Copy of Budget');
  expect(result).toContain('copy-1');
  expect(result).toContain('Copy of Budget');
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: FAIL — `copyFile` is not exported

---

### Task 6: Add `copyFile` — Implementation

**Files:**
- Modify: `src/tools/drive.ts`

**Step 1: Add business logic function**

Add after `getTree`:

```typescript
export async function copyFile(fileId: string, name?: string, parentFolderId?: string): Promise<string> {
  const drive = await getDriveClient();
  if (parentFolderId && !FILE_ID_PATTERN.test(parentFolderId)) throw new Error('Invalid parent ID format.');
  const res = await drive.files.copy({
    fileId,
    requestBody: {
      name: name ?? undefined,
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: 'id,name,mimeType',
  });
  return `Copied: ${res.data.name} | id: ${res.data.id} | type: ${res.data.mimeType}`;
}
```

**Step 2: Register the tool**

Add inside `registerDriveTools`, after `drive_get_tree`:

```typescript
server.registerTool('drive_copy', {
  description: 'Copy a file in Google Drive',
  inputSchema: {
    fileId: z.string().regex(FILE_ID_PATTERN).describe('ID of the file to copy'),
    name: z.string().max(500).optional().describe('Name for the copy (defaults to "Copy of [original]")'),
    parentFolderId: z.string().regex(FILE_ID_PATTERN).optional().describe('Folder to place the copy in'),
  },
}, async ({ fileId, name, parentFolderId }) => {
  try {
    return { content: [{ type: 'text', text: await copyFile(fileId, name, parentFolderId) }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error copying file: ${msg}` }], isError: true };
  }
});
```

**Step 3: Run test to verify it passes**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add src/tools/drive.ts tests/tools/drive.test.ts
git commit -m "feat: add drive_copy tool"
```

---

### Task 7: Add `uploadFile` — Test

**Files:**
- Modify: `tests/tools/drive.test.ts`

**Step 1: Write the failing test**

Add `uploadFile` to the import. Add this test:

```typescript
it('uploadFile creates a file with content', async () => {
  mockFilesCreate.mockResolvedValue({
    data: { id: 'upload-1', name: 'notes.md', mimeType: 'text/markdown' },
  });
  const result = await uploadFile('notes.md', '# My Notes', 'text/markdown');
  expect(result).toContain('upload-1');
  expect(result).toContain('notes.md');
  expect(mockFilesCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      requestBody: expect.objectContaining({ name: 'notes.md' }),
      media: expect.objectContaining({ mimeType: 'text/markdown' }),
    })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: FAIL — `uploadFile` is not exported

---

### Task 8: Add `uploadFile` — Implementation

**Files:**
- Modify: `src/tools/drive.ts`

**Step 1: Add the Readable import at the top of drive.ts**

Add at line 1 (before the existing imports):

```typescript
import { Readable } from 'stream';
```

**Step 2: Add business logic function**

Add after `copyFile`:

```typescript
const ALLOWED_UPLOAD_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json'] as const;
type UploadMimeType = typeof ALLOWED_UPLOAD_TYPES[number];

export async function uploadFile(
  name: string,
  content: string,
  mimeType: UploadMimeType = 'text/plain',
  parentFolderId?: string
): Promise<string> {
  const drive = await getDriveClient();
  if (parentFolderId && !FILE_ID_PATTERN.test(parentFolderId)) throw new Error('Invalid parent ID format.');
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType,
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    media: {
      mimeType,
      body: Readable.from(content),
    },
    fields: 'id,name,mimeType',
  });
  return `Uploaded: ${res.data.name} | id: ${res.data.id} | type: ${res.data.mimeType}`;
}
```

**Step 3: Register the tool**

Add inside `registerDriveTools`, after `drive_copy`:

```typescript
server.registerTool('drive_upload', {
  description: 'Upload text content as a file to Google Drive',
  inputSchema: {
    name: z.string().max(500).describe('File name (e.g. "notes.md")'),
    content: z.string().max(100000).describe('Text content of the file'),
    mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/json']).optional()
      .describe('File MIME type (default: text/plain)'),
    parentFolderId: z.string().regex(FILE_ID_PATTERN).optional().describe('Folder to upload into'),
  },
}, async ({ name, content, mimeType, parentFolderId }) => {
  try {
    return { content: [{ type: 'text', text: await uploadFile(name, content, mimeType, parentFolderId) }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error uploading file: ${msg}` }], isError: true };
  }
});
```

**Step 4: Run test to verify it passes**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add src/tools/drive.ts tests/tools/drive.test.ts
git commit -m "feat: add drive_upload tool for text file uploads"
```

---

### Task 9: Add `starFile` and `listStarred` — Tests

**Files:**
- Modify: `tests/tools/drive.test.ts`

**Step 1: Write the failing tests**

Add `starFile, listStarred` to the import. Add these tests:

```typescript
it('starFile stars a file', async () => {
  mockFilesUpdate.mockResolvedValue({ data: {} });
  const result = await starFile('file-1', true);
  expect(result).toContain('starred');
  expect(mockFilesUpdate).toHaveBeenCalledWith({
    fileId: 'file-1',
    requestBody: { starred: true },
  });
});

it('listStarred returns starred files', async () => {
  mockFilesList.mockResolvedValue({
    data: { files: [{ id: 's-1', name: 'Important', mimeType: 'text/plain' }] },
  });
  const result = await listStarred();
  expect(result).toContain('Important');
  expect(mockFilesList).toHaveBeenCalledWith(
    expect.objectContaining({ q: 'starred = true and trashed = false' })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: FAIL — `starFile` and `listStarred` are not exported

---

### Task 10: Add `starFile` and `listStarred` — Implementation

**Files:**
- Modify: `src/tools/drive.ts`

**Step 1: Add business logic functions**

Add after `uploadFile`:

```typescript
export async function starFile(fileId: string, starred: boolean): Promise<string> {
  const drive = await getDriveClient();
  await drive.files.update({
    fileId,
    requestBody: { starred },
  });
  return `File ${fileId} ${starred ? 'starred' : 'unstarred'}.`;
}

export async function listStarred(pageSize = 20): Promise<string> {
  const drive = await getDriveClient();
  const clampedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const res = await drive.files.list({
    q: 'starred = true and trashed = false',
    pageSize: clampedPageSize,
    fields: 'files(id,name,mimeType,modifiedTime)',
  });
  const files = res.data.files ?? [];
  if (files.length === 0) return 'No starred files found.';
  return files.map(f => `⭐ ${f.name} | id: ${f.id} | type: ${f.mimeType}`).join('\n');
}
```

**Step 2: Register both tools**

Add inside `registerDriveTools`, after `drive_upload`:

```typescript
server.registerTool('drive_star', {
  description: 'Star or unstar a file in Google Drive for quick access',
  inputSchema: {
    fileId: z.string().regex(FILE_ID_PATTERN).describe('ID of the file to star/unstar'),
    starred: z.boolean().describe('true to star, false to unstar'),
  },
}, async ({ fileId, starred }) => {
  try {
    return { content: [{ type: 'text', text: await starFile(fileId, starred) }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error starring file: ${msg}` }], isError: true };
  }
});

server.registerTool('drive_list_starred', {
  description: 'List all starred files in Google Drive',
  inputSchema: {
    pageSize: z.number().int().min(1).max(100).optional().describe('Max results (default 20, max 100)'),
  },
}, async ({ pageSize }) => {
  try {
    return { content: [{ type: 'text', text: await listStarred(pageSize) }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error listing starred files: ${msg}` }], isError: true };
  }
});
```

**Step 3: Run test to verify it passes**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/drive.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add src/tools/drive.ts tests/tools/drive.test.ts
git commit -m "feat: add drive_star and drive_list_starred tools"
```

---

### Task 11: Modify `docs_create` to accept parentFolderId — Test

**Files:**
- Modify: `tests/tools/docs.test.ts`

**Step 1: Write the failing test**

The mock already has `google.drive` with `files.update`. We need to capture that mock. Update the mock setup at line 16-18 to capture the update function:

```typescript
const mockDriveFilesUpdate = vi.fn().mockResolvedValue({});
```

Then update the `drive` mock:

```typescript
drive: vi.fn().mockReturnValue({
  files: { update: mockDriveFilesUpdate },
}),
```

Add test:

```typescript
it('createDoc with parentFolderId moves doc to folder', async () => {
  mockDocumentsCreate.mockResolvedValue({ data: { documentId: 'doc-2', title: 'Nested Doc' } });
  mockDriveFilesUpdate.mockResolvedValue({});
  const result = await createDoc('Nested Doc', 'folder-abc');
  expect(result).toContain('doc-2');
  expect(result).toContain('Nested Doc');
  expect(mockDriveFilesUpdate).toHaveBeenCalledWith({
    fileId: 'doc-2',
    addParents: 'folder-abc',
    fields: 'id,parents',
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/docs.test.ts`
Expected: FAIL — `createDoc` doesn't accept a second argument

---

### Task 12: Modify `docs_create` to accept parentFolderId — Implementation

**Files:**
- Modify: `src/tools/docs.ts`

**Step 1: Update the business logic function**

Change `createDoc` (line 34-38) to:

```typescript
export async function createDoc(title: string, parentFolderId?: string): Promise<string> {
  const docs = await getDocsClient();
  const res = await docs.documents.create({ requestBody: { title } });
  const docId = res.data.documentId!;
  if (parentFolderId) {
    const drive = await getDriveClient();
    await drive.files.update({
      fileId: docId,
      addParents: parentFolderId,
      fields: 'id,parents',
    });
  }
  return `Document created: "${res.data.title}" | id: ${docId}`;
}
```

**Step 2: Update the tool registration**

Change the `docs_create` inputSchema (line 99-101) to:

```typescript
inputSchema: {
  title: z.string().max(500).describe('Title of the new document'),
  parentFolderId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().describe('Folder ID to create the document in'),
},
```

Update the handler (line 102-103) to:

```typescript
}, async ({ title, parentFolderId }) => {
  try {
    return { content: [{ type: 'text', text: await createDoc(title, parentFolderId) }] };
```

**Step 3: Run test to verify it passes**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/docs.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add src/tools/docs.ts tests/tools/docs.test.ts
git commit -m "feat: add parentFolderId parameter to docs_create"
```

---

### Task 13: Modify `sheets_create` to accept parentFolderId — Test

**Files:**
- Modify: `tests/tools/sheets.test.ts`

**Step 1: Write the failing test**

The mock already has `mockFilesUpdate`. Add test:

```typescript
it('createSpreadsheet with parentFolderId moves sheet to folder', async () => {
  mockSpreadsheetsCreate.mockResolvedValue({
    data: { spreadsheetId: 'sp-2', properties: { title: 'Nested Sheet' } },
  });
  mockFilesUpdate.mockResolvedValue({});
  const result = await createSpreadsheet('Nested Sheet', 'folder-xyz');
  expect(result).toContain('sp-2');
  expect(result).toContain('Nested Sheet');
  expect(mockFilesUpdate).toHaveBeenCalledWith({
    fileId: 'sp-2',
    addParents: 'folder-xyz',
    fields: 'id,parents',
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/sheets.test.ts`
Expected: FAIL — `createSpreadsheet` doesn't accept a second argument

---

### Task 14: Modify `sheets_create` to accept parentFolderId — Implementation

**Files:**
- Modify: `src/tools/sheets.ts`

**Step 1: Update the business logic function**

Change `createSpreadsheet` (line 26-33) to:

```typescript
export async function createSpreadsheet(title: string, parentFolderId?: string): Promise<string> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
    fields: 'spreadsheetId,properties.title',
  });
  const sheetId = res.data.spreadsheetId!;
  if (parentFolderId) {
    const drive = await getDriveClient();
    await drive.files.update({
      fileId: sheetId,
      addParents: parentFolderId,
      fields: 'id,parents',
    });
  }
  return `Spreadsheet created: "${res.data.properties?.title}" | id: ${sheetId}`;
}
```

**Step 2: Update the tool registration**

Change the `sheets_create` inputSchema (line 96-98) to:

```typescript
inputSchema: {
  title: z.string().max(500).describe('Title of the new spreadsheet'),
  parentFolderId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().describe('Folder ID to create the spreadsheet in'),
},
```

Update the handler to:

```typescript
}, async ({ title, parentFolderId }) => {
  try {
    return { content: [{ type: 'text', text: await createSpreadsheet(title, parentFolderId) }] };
```

**Step 3: Run test to verify it passes**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run tests/tools/sheets.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add src/tools/sheets.ts tests/tools/sheets.test.ts
git commit -m "feat: add parentFolderId parameter to sheets_create"
```

---

### Task 15: Run all tests and update README

**Files:**
- Modify: `README.md`

**Step 1: Run all tests**

Run: `cd ~/dev/google-workspace-mcp && npx vitest run`
Expected: All tests PASS

**Step 2: Build**

Run: `cd ~/dev/google-workspace-mcp && npm run build`
Expected: Clean compile, no errors

**Step 3: Update README**

Update the Google Drive section in README.md to include new tools:

```markdown
**Google Drive**
- `drive_list` — List files and folders
- `drive_search` — Search files by name
- `drive_get` — Get file metadata
- `drive_create_folder` — Create a folder
- `drive_move` — Move a file to a different folder
- `drive_delete` — Move a file to trash
- `drive_rename` — Rename a file or folder
- `drive_get_tree` — View folder hierarchy as a tree
- `drive_copy` — Copy a file
- `drive_upload` — Upload text content as a file
- `drive_star` — Star or unstar a file
- `drive_list_starred` — List starred files
```

Update the tool count from "24 tools" to "30 tools" in the title and description.

Update the Docs section to note `parentFolderId`:
```markdown
- `docs_create` — Create a new document (optionally in a specific folder)
```

Update the Sheets section:
```markdown
- `sheets_create` — Create a new spreadsheet (optionally in a specific folder)
```

Update test count in Development section from "29 tests" to the new count.

Add second brain usage examples:

```markdown
> "Create a 'Second Brain' folder in my Drive with subfolders for Projects, Ideas, and Resources"

> "Upload my meeting notes to the Projects folder"

> "Show me the folder tree of my Second Brain"

> "Star the most important documents for quick access"
```

**Step 4: Commit**

```bash
cd ~/dev/google-workspace-mcp
git add README.md
git commit -m "docs: update README with new Drive tools and second brain examples"
```

---

### Task 16: Final build and push

**Step 1: Final build**

Run: `cd ~/dev/google-workspace-mcp && npm run build`

**Step 2: Push**

Run: `cd ~/dev/google-workspace-mcp && git push`
