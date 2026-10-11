import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withAccount } from './auth.js';

const accountArg = z
  .string()
  .email()
  .optional()
  .describe('Google account email to act as. Omit to use the default account (see accounts_list).');

// Makes every tool registered after this call accept an optional `account`
// argument and run under that account. Tool code stays account-unaware:
// getAuthenticatedClient reads the account from the call's async context.
export function addAccountArgument(server: McpServer): void {
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  type Config = { inputSchema?: Record<string, unknown> } & Record<string, unknown>;
  type Handler = (args: Record<string, unknown>, extra: unknown) => unknown;
  (server as unknown as { registerTool: unknown }).registerTool = (name: string, config: Config, handler: Handler) =>
    register(
      name,
      { ...config, inputSchema: { ...config.inputSchema, account: accountArg } },
      (args: Record<string, unknown>, extra: unknown) =>
        withAccount(args.account as string | undefined, () => handler(args, extra)),
    );
}
