# google-workspace-mcp — agent context

TypeScript MCP server: read/write Google Docs, Sheets, Drive, Calendar, and file comments, across multiple Google accounts. Public repo; notes files stay local via exclude. Exists because official Google MCP servers still cannot edit Docs/Sheets in place.

## Must-nots / privacy
- Never commit OAuth client secrets or tokens. Tokens live in the macOS Keychain (service `google-workspace-mcp`, account `tokens`) or `~/.google-workspace-mcp/tokens.json` elsewhere.
- Do not commit `_brain.md` / `CLAUDE.md` into the public tree.
- Never put `GOOGLE_CLIENT_SECRET` in a client config (`~/.claude.json`, `~/.codex/config.toml`). The server reads it from the Keychain (service `google-workspace-mcp`, account `client-secret`), and an env value overrides the Keychain, so a stale copy breaks auth.
- Every client config that spawns one server per thread or chat (Codex) must set `MCP_IDLE_EXIT_MINUTES` (30 today) so idle servers exit instead of piling up on stale builds. Claude Code spawns one per session and needs no value. The server always exits when its client closes stdin.
- After rebuilding `dist`, kill running servers so clients respawn on the new build: `pkill -f 31_google-workspace-mcp/dist/index.js`, then restart or reconnect the client.

## Build / run / test
```bash
npm install
npm run build
npm test               # vitest suite (mocked googleapis)
node dist/index.js    # stdio MCP; needs GOOGLE_CLIENT_ID (secret from Keychain); registered user-scope in Claude Code and in ~/.codex/config.toml as google-workspace
```
Re-auth via the `authorize` MCP tool when refresh tokens expire (`invalid_grant`): open the URL it returns and approve.

Durable status and open items: `_brain.md`.
