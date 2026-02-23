# Google Workspace MCP Server for Claude Desktop

A TypeScript MCP (Model Context Protocol) server that gives Claude Desktop read/write access to Google Docs, Sheets, and Drive.

17 tools across three services — create, edit, search, and manage your Google Workspace files directly from Claude.

## Features

**Google Docs**
- `docs_get` — Read full document content
- `docs_create` — Create a new document
- `docs_append` — Append text to a document
- `docs_replace` — Find and replace text
- `docs_delete` — Move a document to trash

**Google Sheets**
- `sheets_get` — Read cell values from a range
- `sheets_create` — Create a new spreadsheet
- `sheets_update` — Write values to a range
- `sheets_append` — Append rows to a sheet
- `sheets_clear` — Clear a range
- `sheets_delete` — Move a spreadsheet to trash

**Google Drive**
- `drive_list` — List files and folders
- `drive_search` — Search files by name
- `drive_get` — Get file metadata
- `drive_create_folder` — Create a folder
- `drive_move` — Move a file to a different folder
- `drive_delete` — Move a file to trash

## Prerequisites

- Node.js 18 or higher
- A Google Cloud project with OAuth 2.0 credentials

## Setup

### 1. Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth Client ID**
5. Choose **Desktop Application** as the application type
6. Download or note the **Client ID** and **Client Secret**

Enable the following APIs for your project:
- [Google Docs API](https://console.cloud.google.com/flows/enableapi?apiid=docs.googleapis.com)
- [Google Drive API](https://console.cloud.google.com/flows/enableapi?apiid=drive.googleapis.com)
- [Google Sheets API](https://console.cloud.google.com/flows/enableapi?apiid=sheets.googleapis.com)

### 2. Install and Build

```bash
git clone https://github.com/laltaffer/google-workspace-mcp.git
cd google-workspace-mcp
npm install
npm run build
```

### 3. Configure Claude Desktop

Add the following to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/google-workspace-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Replace `/absolute/path/to/google-workspace-mcp` with the actual path where you cloned the repo.

### 4. Restart Claude Desktop

Fully quit and reopen Claude Desktop.

### 5. Authorize

In a new Claude chat, say:
> "Call the authorize tool"

Claude will return a Google authorization URL. Open it in your browser, sign in, and grant access. Your browser will show "Authorization complete!" — you only need to do this once. Tokens are saved to `~/.google-workspace-mcp/tokens.json`.

You can now use all Google Workspace tools in Claude.

## Usage Examples

> "List my Google Drive files"

> "Create a new Google Doc called 'Meeting Notes' and add an agenda"

> "Read the spreadsheet with ID 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms and summarize it"

> "Find all documents with 'Q1' in the name"

> "Append a new row to my budget spreadsheet: ['March', '4500', 'Rent']"

## Development

```bash
npm test          # run tests
npm run test:watch  # watch mode
npm run build     # compile TypeScript
```

The project uses [vitest](https://vitest.dev/) for testing with mocked googleapis clients. 19 tests across auth, Drive, Docs, and Sheets modules.

## Token Storage

OAuth tokens are stored locally at `~/.google-workspace-mcp/tokens.json`. They are never committed to this repository. To revoke access, delete that file or revoke the app in your [Google Account security settings](https://myaccount.google.com/permissions).

## Tech Stack

- [TypeScript](https://www.typescriptlang.org/)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [googleapis](https://github.com/googleapis/google-api-nodejs-client)
- [zod](https://zod.dev/)
- [vitest](https://vitest.dev/)
