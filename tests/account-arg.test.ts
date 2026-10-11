import { describe, it, expect, vi } from 'vitest';

const seen: Array<string | undefined> = [];
vi.mock('../src/auth.js', () => ({
  withAccount: (account: string | undefined, fn: () => unknown) => {
    seen.push(account);
    return fn();
  },
}));

const { addAccountArgument } = await import('../src/account-arg.js');

describe('addAccountArgument', () => {
  it('adds an optional account input and runs the handler under that account', async () => {
    const registered: Array<{ name: string; config: any; handler: any }> = [];
    const server: any = {
      registerTool(name: string, config: any, handler: any) {
        registered.push({ name, config, handler });
      },
    };
    addAccountArgument(server);
    const handler = vi.fn().mockResolvedValue('ok');
    server.registerTool('drive_list', { description: 'd', inputSchema: { pageSize: 'schema' } }, handler);

    const { config, handler: wrapped } = registered[0];
    expect(Object.keys(config.inputSchema)).toEqual(['pageSize', 'account']);
    expect(config.inputSchema.account.safeParse(undefined).success).toBe(true);
    expect(config.inputSchema.account.safeParse('not-an-email').success).toBe(false);

    expect(await wrapped({ pageSize: 5, account: 'b@x.com' }, 'extra')).toBe('ok');
    expect(seen).toEqual(['b@x.com']);
    expect(handler).toHaveBeenCalledWith({ pageSize: 5, account: 'b@x.com' }, 'extra');
  });
});
