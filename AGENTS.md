# google-workspace-mcp — agent context

TypeScript MCP server: read/write Google Docs, Sheets, Drive, Calendar, and file comments (27 tools). Public repo; notes files stay local via exclude. Exists because official Google MCP servers still cannot edit Docs/Sheets in place.

## Must-nots / privacy
- Never commit OAuth client secrets, tokens, or `~/.google-workspace-mcp/tokens.json`.
- Do not commit `_brain.md` / `CLAUDE.md` into the public tree.
- One token file = one account at a time today — authorizing another account replaces reach into the first.

## Build / run / test
```bash
npm install
npm run build
npm test
node dist/index.js    # stdio MCP; needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
```
Re-auth via the `authorize` MCP tool when refresh tokens expire (`invalid_grant`).

Durable status (Testing vs publish constraints): `_brain.md`.
