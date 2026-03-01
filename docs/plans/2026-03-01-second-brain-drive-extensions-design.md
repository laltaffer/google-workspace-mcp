# Second Brain Drive Extensions — Design

**Date:** 2026-03-01
**Status:** Approved

## Goal

Extend google-workspace-mcp with Drive tools that enable Claude (mobile and desktop) to serve as a "second brain" — capturing, organizing, and retrieving notes, docs, and mixed media in Google Drive.

## Context

The project already has 24 tools across Drive, Docs, Sheets, and Calendar. The existing Drive tools cover basic CRUD but lack capabilities needed for organizing a knowledge base: no rename, no recursive tree view, no copy, no file upload, no parent folder on doc/sheet creation, and no starring.

## Approach

**Approach A (selected):** Add 6 new Drive tools and modify 2 existing create tools. Provides clean primitives that Claude chains naturally into second-brain workflows without dedicated high-level tools.

Rejected alternatives:
- **B (Second Brain Toolkit):** Dedicated `brain_init`/`brain_capture`/`brain_browse` tools — overengineered, duplicates what Claude does naturally with good primitives.
- **C (Just folder tools):** Only rename + tree — too minimal, missing real functionality.

## New Tools

### `drive_rename`
- **Purpose:** Rename any file or folder
- **Input:** `fileId` (string, required), `name` (string, required, max 500 chars)
- **API:** `files.update({ name })` — Drive API v3
- **Output:** Updated file metadata (id, name, mimeType)

### `drive_get_tree`
- **Purpose:** Get recursive folder hierarchy as text
- **Input:** `folderId` (string, optional — defaults to root), `depth` (number, optional, default 3, max 5)
- **API:** Recursive `files.list` with `'<folderId>' in parents`
- **Output:** Indented tree structure with folder names and file counts
- **Safety:** Depth-limited to max 5 to prevent excessive API calls

### `drive_copy`
- **Purpose:** Copy a file
- **Input:** `fileId` (string, required), `name` (string, optional), `parentFolderId` (string, optional)
- **API:** `files.copy()` — Drive API v3
- **Output:** New file metadata

### `drive_upload`
- **Purpose:** Upload text content as a file to Drive
- **Input:** `name` (string, required, max 500), `content` (string, required, max 100,000), `mimeType` (enum, optional, default `text/plain`), `parentFolderId` (string, optional)
- **Allowed mimeTypes:** `text/plain`, `text/markdown`, `text/csv`, `application/json`
- **API:** `files.create` with media body
- **Output:** Created file metadata

### `drive_star`
- **Purpose:** Star or unstar a file for quick access
- **Input:** `fileId` (string, required), `starred` (boolean, required)
- **API:** `files.update({ starred })` — Drive API v3
- **Output:** Confirmation message

### `drive_list_starred`
- **Purpose:** List all starred files
- **Input:** `pageSize` (number, optional, default 20, max 100)
- **API:** `files.list` with query `starred = true`
- **Output:** File list with metadata

## Modified Tools

### `docs_create` — Add `parentFolderId`
- New optional parameter: `parentFolderId` (string)
- If provided: create doc, then `files.update({ addParents, removeParents })` to move it
- Existing behavior unchanged when omitted

### `sheets_create` — Add `parentFolderId`
- Same pattern as `docs_create` modification

## Security & Validation

- All inputs validated with Zod (existing patterns)
- File IDs: regex `^[a-zA-Z0-9_-]+$`
- String lengths: 500 for names, 100,000 for content
- `drive_upload` mimeType restricted to allowlist
- `drive_get_tree` depth capped at 5
- Drive content wrapped in `[UNTRUSTED CONTENT]` markers

## Testing

- Unit tests for each new business logic function
- Mock `googleapis` and `auth` modules (existing pattern)
- Test cases: success, auth failure, validation errors, edge cases
- Target: maintain existing test coverage patterns
