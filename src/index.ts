import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startAuthFlow, getAuthenticatedClient, validateCredentials, clearTokens } from './auth.js';
import { registerDriveTools } from './tools/drive.js';
import { registerDocsTools } from './tools/docs.js';
import { registerSheetsTools } from './tools/sheets.js';
import { registerCalendarTools } from './tools/calendar.js';

const server = new McpServer({
  name: 'google-workspace',
  version: '1.0.0',
});

server.registerTool('authorize', {
  description: 'Start Google OAuth2 authorization. Returns a URL to open in your browser. The server will capture the token automatically when you complete authorization.',
  inputSchema: {},
}, async () => {
  const existing = await getAuthenticatedClient();
  if (existing && await validateCredentials(existing)) {
    return { content: [{ type: 'text' as const, text: 'Already authorized. You can use Google Workspace tools.' }] };
  }
  // Stored tokens are unusable (commonly a revoked refresh token). Move them
  // aside so they stop masquerading as valid credentials, then re-authorize.
  const stale = existing !== null;
  if (stale) await clearTokens();
  const authUrl = await startAuthFlow();
  const prefix = stale ? 'Stored credentials are no longer valid (revoked or expired).\n\n' : '';
  return {
    content: [{
      type: 'text' as const,
      text: `${prefix}Open this URL in your browser to authorize:\n\n${authUrl}\n\nAfter authorizing, you can use all Google Workspace tools.`,
    }],
  };
});

registerDriveTools(server);
registerDocsTools(server);
registerSheetsTools(server);
registerCalendarTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
