# Google Workspace MCP Server

A TypeScript MCP (Model Context Protocol) server that gives Claude read/write access to Google Docs, Sheets, Drive, Calendar, and file comments. Works with Claude Code and Claude Desktop.

27 tools across five services — create, edit, search, and manage your Google Workspace files and events directly from Claude.

## Features

**Google Docs**
- `docs_get` — Read a document as markdown (headings, bullets, links, tables), optionally with edit indices
- `docs_create` — Create a new document
- `docs_append` — Append text to a document
- `docs_replace` — Find and replace text
- `docs_batch_update` — Apply raw Docs API requests for formatting and structural edits
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

**Google Calendar**
- `calendar_list` — List all calendars
- `calendar_events` — List upcoming events
- `calendar_search` — Search events by text
- `calendar_get` — Get full event details
- `calendar_create` — Create a new event
- `calendar_update` — Update an existing event
- `calendar_delete` — Delete an event

**Comments** (Docs, Sheets, and Slides)
- `comments_list` — List open comments with their replies (`includeResolved` to see all)
- `comments_get` — Get one comment and its full thread
- `comments_reply` — Reply to a comment, optionally resolving it

**Accounts**
- `authorize` — Sign in a Google account (pass `account` to add another)
- `accounts_list` — Show authorized accounts and the default

Every other tool takes an optional `account` argument (an email). Without it, the tool acts as the default account, which is the first one authorized.

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
- [Google Calendar API](https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com)

### 2. Install and Build

```bash
git clone https://github.com/laltaffer/google-workspace-mcp.git
cd google-workspace-mcp
npm install
npm run build
```

### 3. Register the server

**Claude Code** — one command, user scope so it loads in every project:

```bash
# macOS: keep the secret out of the config file by storing it in the Keychain
security add-generic-password -s google-workspace-mcp -a client-secret -w your-client-secret

claude mcp add google-workspace --scope user \
  -e GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
  -- node /absolute/path/to/google-workspace-mcp/dist/index.js
```

On other platforms, or if you skip the Keychain step, pass `-e GOOGLE_CLIENT_SECRET=your-client-secret` as well. Note that `claude mcp get` prints env values, so prefer the Keychain where available.

**Claude Desktop** — add the following to your config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/google-workspace-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com"
      }
    }
  }
}
```

Replace `/absolute/path/to/google-workspace-mcp` with the actual path where you cloned the repo.

**Idle exit.** The server exits when its client disconnects. Clients that start one server per thread and keep them all running (the Codex app does this) should also set `MCP_IDLE_EXIT_MINUTES`, for example `"30"`, so idle servers exit instead of accumulating. Add `"GOOGLE_CLIENT_SECRET": "your-client-secret"` to `env` only if you did not store the secret in the macOS Keychain.

### 4. Restart the client

Claude Code picks the server up in new sessions. For Claude Desktop, fully quit and reopen it.

### 5. Authorize

In a new Claude chat, say:
> "Call the authorize tool"

Claude will return a Google authorization URL. Open it in your browser, sign in, and grant access. Your browser will show "Authorization complete!" — you only need to do this once. On macOS, tokens are saved to the Keychain (service `google-workspace-mcp`, account `tokens`); elsewhere they are saved to `~/.google-workspace-mcp/tokens.json`. Set `GOOGLE_WORKSPACE_MCP_TOKEN_STORE=file` to force the file store on macOS.

You can now use all Google Workspace tools in Claude.

**More than one account.** Ask Claude to "authorize laltaffer@example.com" (any email); the tool passes it to Google's account picker. Each account gets its own token, and adding one never signs out another. Then name the account in a request, e.g. "list my Drive files in my work account."

> **Upgrading?** A token stored by an older version is migrated to the multi-account store on first use. If you previously authorized without Calendar support, run the `authorize` tool again; it detects the stale grant, revokes it, and starts a fresh flow.

## Usage Examples

> "List my Google Drive files"

> "Create a new Google Doc called 'Meeting Notes' and add an agenda"

> "Read the spreadsheet with ID 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms and summarize it"

> "Find all documents with 'Q1' in the name"

> "Append a new row to my budget spreadsheet: ['March', '4500', 'Rent']"

> "What's on my calendar this week?"

> "Create a meeting called 'Design Review' tomorrow at 2pm for 1 hour"

> "What comments are open on the doc with ID 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms?"

## Development

```bash
npm test          # run tests
npm run test:watch  # watch mode
npm run build     # compile TypeScript
```

The project uses [vitest](https://vitest.dev/) for testing with mocked googleapis clients, covering auth, accounts, Drive, Docs, Sheets, Calendar, and Comments.

## Token Storage

OAuth tokens are stored locally, one per authorized account, in the macOS Keychain or in `~/.google-workspace-mcp/tokens.json` on other platforms. An existing tokens file is migrated into the Keychain on first use and then deleted. They are never committed to this repository. To revoke every account, run `security delete-generic-password -s google-workspace-mcp -a tokens` (or delete the file), or revoke the app in your [Google Account security settings](https://myaccount.google.com/permissions).

## Tech Stack

- [TypeScript](https://www.typescriptlang.org/)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [googleapis](https://github.com/googleapis/google-api-nodejs-client)
- [zod](https://zod.dev/)
- [vitest](https://vitest.dev/)

## License

MIT.
