import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  startAuthFlow, getAuthenticatedClient, validateCredentials, removeAccount, loadStore, withAccount,
} from './auth.js';
import { addAccountArgument } from './account-arg.js';
import { registerDriveTools } from './tools/drive.js';
import { registerDocsTools } from './tools/docs.js';
import { registerSheetsTools } from './tools/sheets.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerCommentsTools } from './tools/comments.js';

const server = new McpServer({
  name: 'google-workspace',
  version: '1.0.0',
});

server.registerTool('authorize', {
  description: 'Authorize a Google account. Returns a URL to open in your browser; the token is captured automatically. Pass account to add or re-authorize a specific account; several accounts can be authorized at once.',
  inputSchema: {
    account: z.string().email().optional().describe('Email of the account to authorize. Omit to check the default account.'),
  },
}, async ({ account }) => {
  const store = await loadStore();
  const target = account?.toLowerCase() ?? store.default;
  let stale = false;
  if (target && store.accounts[target]) {
    const client = await withAccount(target, getAuthenticatedClient);
    if (client && await validateCredentials(client)) {
      const hint = account ? '' : ' To add another account, call authorize with its email.';
      return { content: [{ type: 'text' as const, text: `Already authorized as ${target}.${hint}` }] };
    }
    // Revoked or expired: remove it so it stops masquerading as valid.
    await removeAccount(target);
    stale = true;
  }
  const authUrl = await startAuthFlow(account);
  const prefix = stale ? `Stored credentials for ${target} are no longer valid (revoked or expired).\n\n` : '';
  return {
    content: [{
      type: 'text' as const,
      text: `${prefix}Open this URL in your browser to authorize${account ? ` ${account}` : ''}:\n\n${authUrl}\n\nChoose the account in Google's picker. After authorizing, pass account to any tool to act as it.`,
    }],
  };
});

server.registerTool('accounts_list', {
  description: 'List the Google accounts this server holds credentials for, and which one is the default.',
  inputSchema: {},
}, async () => {
  const store = await loadStore();
  const emails = Object.keys(store.accounts);
  const text = emails.length
    ? emails.map(e => `${e}${e === store.default ? ' (default)' : ''}`).join('\n')
    : 'No accounts authorized. Call authorize.';
  return { content: [{ type: 'text' as const, text }] };
});

addAccountArgument(server);

registerDriveTools(server);
registerDocsTools(server);
registerSheetsTools(server);
registerCalendarTools(server);
registerCommentsTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
