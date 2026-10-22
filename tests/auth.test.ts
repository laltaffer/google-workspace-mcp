import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Mock fs and googleapis before importing auth
vi.mock('fs/promises');
vi.mock('child_process', () => ({ execFileSync: vi.fn() }));
const mockAboutGet = vi.fn();
vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({ about: { get: mockAboutGet } })),
    auth: {
      OAuth2: vi.fn(function () { return {
        generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock'),
        getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'tok', refresh_token: 'ref' } }),
        setCredentials: vi.fn(),
        on: vi.fn(),
      }; }),
    },
  },
}));

const TOKENS_PATH = path.join(os.homedir(), '.google-workspace-mcp', 'tokens.json');

describe('auth', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('GOOGLE_WORKSPACE_MCP_TOKEN_STORE', 'file');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('loadTokens', () => {
    it('returns null when tokens file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      const { loadTokens } = await import('../src/auth.js');
      expect(await loadTokens()).toBeNull();
    });

    it('returns parsed tokens when file exists', async () => {
      const tokens = { access_token: 'abc', refresh_token: 'xyz' };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(tokens) as any);
      const { loadTokens } = await import('../src/auth.js');
      expect(await loadTokens()).toEqual(tokens);
    });
  });

  describe('saveTokens', () => {
    it('creates directory and writes tokens file', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      const { saveTokens } = await import('../src/auth.js');
      await saveTokens({ access_token: 'abc' });
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(TOKENS_PATH), { recursive: true, mode: 0o700 });
      expect(fs.writeFile).toHaveBeenCalledWith(
        TOKENS_PATH,
        expect.stringContaining('access_token'),
        { mode: 0o600 }
      );
    });
  });

  describe('keychain token store', () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64');
    const useKeychain = () => vi.stubEnv('GOOGLE_WORKSPACE_MCP_TOKEN_STORE', 'keychain');

    it('loadTokens decodes the Keychain entry', async () => {
      useKeychain();
      vi.mocked(execFileSync).mockReturnValue(b64({ access_token: 'k' }) + '\n');
      const { loadTokens } = await import('../src/auth.js');
      expect(await loadTokens()).toEqual({ access_token: 'k' });
      expect(execFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'google-workspace-mcp', '-a', 'tokens', '-w'],
        expect.anything(),
      );
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('loadTokens migrates a legacy tokens file into the Keychain and deletes it', async () => {
      useKeychain();
      vi.mocked(execFileSync)
        .mockImplementationOnce(() => { throw new Error('not found'); })
        .mockReturnValue('');
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ refresh_token: 'legacy' }));
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      const { loadTokens } = await import('../src/auth.js');
      expect(await loadTokens()).toEqual({ refresh_token: 'legacy' });
      const write = vi.mocked(execFileSync).mock.calls.find(c => c[1]?.[0] === '-i');
      expect(write).toBeTruthy();
      expect(String(write![2]!.input)).toContain(`-w ${b64({ refresh_token: 'legacy' })}`);
      expect(fs.unlink).toHaveBeenCalledWith(TOKENS_PATH);
    });

    it('loadTokens returns null when neither store has tokens', async () => {
      useKeychain();
      vi.mocked(execFileSync).mockImplementation(() => { throw new Error('not found'); });
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      const { loadTokens } = await import('../src/auth.js');
      expect(await loadTokens()).toBeNull();
    });

    it('saveTokens writes base64 JSON through security -i on stdin, never argv', async () => {
      useKeychain();
      vi.mocked(execFileSync).mockReturnValue('');
      const { saveTokens } = await import('../src/auth.js');
      await saveTokens({ access_token: 'secret' });
      const [cmd, args, opts] = vi.mocked(execFileSync).mock.calls.at(-1)!;
      expect(cmd).toBe('security');
      expect(args).toEqual(['-i']);
      expect(JSON.stringify(args)).not.toContain('secret');
      expect(String(opts!.input)).toBe(
        `add-generic-password -U -s google-workspace-mcp -a tokens -w ${b64({ access_token: 'secret' })}\n`,
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('removing the last account deletes the Keychain entry and any legacy file', async () => {
      useKeychain();
      vi.mocked(execFileSync).mockReturnValue(
        b64({ default: 'a@x.com', accounts: { 'a@x.com': { refresh_token: 'ref' } } }),
      );
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
      const { removeAccount } = await import('../src/auth.js');
      await removeAccount('a@x.com');
      expect(execFileSync).toHaveBeenCalledWith(
        'security',
        ['delete-generic-password', '-s', 'google-workspace-mcp', '-a', 'tokens'],
        expect.anything(),
      );
      expect(fs.unlink).toHaveBeenCalledWith(TOKENS_PATH);
      vi.unstubAllGlobals();
    });
  });

  describe('describeError', () => {
    it('rewrites invalid_grant into an authorize hint', async () => {
      const { describeError } = await import('../src/auth.js');
      expect(describeError(new Error('invalid_grant'))).toContain('authorize');
      expect(describeError(new Error('Requested entity was not found.'))).toBe('Requested entity was not found.');
    });
  });

  describe('multi-account store', () => {
    const store = (o: object) => vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(o));
    const written = () => JSON.parse(String(vi.mocked(fs.writeFile).mock.calls.at(-1)![1]));
    const two = {
      default: 'a@x.com',
      accounts: { 'a@x.com': { refresh_token: 'ra' }, 'b@x.com': { refresh_token: 'rb' } },
    };

    it('migrates a bare legacy credential into a one-account store', async () => {
      store({ access_token: 'old', refresh_token: 'r' });
      mockAboutGet.mockResolvedValue({ data: { user: { emailAddress: 'Me@Gmail.com' } } });
      const { loadStore } = await import('../src/auth.js');
      const s = await loadStore();
      expect(s).toEqual({ default: 'me@gmail.com', accounts: { 'me@gmail.com': { access_token: 'old', refresh_token: 'r' } } });
      expect(written()).toEqual(s);
    });

    it('leaves a dead legacy credential unmigrated', async () => {
      store({ refresh_token: 'dead' });
      mockAboutGet.mockRejectedValue(new Error('invalid_grant'));
      const { loadStore } = await import('../src/auth.js');
      expect(await loadStore()).toEqual({ accounts: {} });
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('getAuthenticatedClient uses the default account, or the one set by withAccount', async () => {
      store(two);
      const { getAuthenticatedClient, withAccount } = await import('../src/auth.js');
      const def = await getAuthenticatedClient();
      expect(vi.mocked(def!.setCredentials)).toHaveBeenCalledWith({ refresh_token: 'ra' });
      const b = await withAccount('B@x.com', getAuthenticatedClient);
      expect(vi.mocked(b!.setCredentials)).toHaveBeenCalledWith({ refresh_token: 'rb' });
    });

    it('getAuthenticatedClient names known accounts when asked for an unknown one', async () => {
      store(two);
      const { getAuthenticatedClient, withAccount } = await import('../src/auth.js');
      await expect(withAccount('c@x.com', getAuthenticatedClient)).rejects.toThrow(
        /No stored credentials for c@x.com\. Authorized accounts: a@x.com, b@x.com/,
      );
    });

    it('getAuthenticatedClient returns null when nothing is authorized', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      const { getAuthenticatedClient } = await import('../src/auth.js');
      expect(await getAuthenticatedClient()).toBeNull();
    });

    it('saveAccount adds an account without changing the default', async () => {
      store({ default: 'a@x.com', accounts: { 'a@x.com': { refresh_token: 'ra' } } });
      const { saveAccount } = await import('../src/auth.js');
      await saveAccount('B@x.com', { refresh_token: 'rb' });
      expect(written()).toEqual(two);
    });

    it('saveAccount makes the first account the default', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      const { saveAccount } = await import('../src/auth.js');
      await saveAccount('a@x.com', { refresh_token: 'ra' });
      expect(written()).toEqual({ default: 'a@x.com', accounts: { 'a@x.com': { refresh_token: 'ra' } } });
    });

    it('removeAccount revokes only that account and reassigns the default', async () => {
      store(two);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const { removeAccount } = await import('../src/auth.js');
      await removeAccount('a@x.com');
      expect(String(fetchMock.mock.calls[0][1].body)).toBe('token=ra');
      expect(written()).toEqual({ default: 'b@x.com', accounts: { 'b@x.com': { refresh_token: 'rb' } } });
      expect(fs.unlink).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('removeAccount deletes the store when the last account goes, even if revoke fails', async () => {
      store({ default: 'a@x.com', accounts: { 'a@x.com': { refresh_token: 'ra' } } });
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      const { removeAccount } = await import('../src/auth.js');
      await expect(removeAccount('a@x.com')).resolves.toBeUndefined();
      expect(fs.unlink).toHaveBeenCalledWith(TOKENS_PATH);
      vi.unstubAllGlobals();
    });
  });

  describe('validateCredentials', () => {
    it('returns true when the access token refreshes and Google accepts it', async () => {
      const client = {
        getAccessToken: vi.fn().mockResolvedValue({ token: 'live-token' }),
        getTokenInfo: vi.fn().mockResolvedValue({ scopes: [] }),
      };
      const { validateCredentials } = await import('../src/auth.js');
      expect(await validateCredentials(client as any)).toBe(true);
      expect(client.getTokenInfo).toHaveBeenCalledWith('live-token');
    });

    it('returns false when the refresh token was revoked', async () => {
      const client = {
        getAccessToken: vi.fn().mockRejectedValue(new Error('invalid_grant')),
        getTokenInfo: vi.fn(),
      };
      const { validateCredentials } = await import('../src/auth.js');
      expect(await validateCredentials(client as any)).toBe(false);
    });

    it('returns false when Google rejects the access token', async () => {
      const client = {
        getAccessToken: vi.fn().mockResolvedValue({ token: 'stale-token' }),
        getTokenInfo: vi.fn().mockRejectedValue(new Error('invalid_token')),
      };
      const { validateCredentials } = await import('../src/auth.js');
      expect(await validateCredentials(client as any)).toBe(false);
    });

    it('returns false when no access token is available', async () => {
      const client = {
        getAccessToken: vi.fn().mockResolvedValue({ token: null }),
        getTokenInfo: vi.fn(),
      };
      const { validateCredentials } = await import('../src/auth.js');
      expect(await validateCredentials(client as any)).toBe(false);
    });
  });

  describe('createOAuthClient', () => {
    it('throws if env vars are missing', async () => {
      vi.unstubAllEnvs();
      const { createOAuthClient } = await import('../src/auth.js');
      expect(() => createOAuthClient()).toThrow('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
    });

    it('uses the secret Keychain fallback only on macOS', async () => {
      vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
      vi.mocked(execFileSync).mockReturnValue('keychain-secret\n' as any);
      const { google } = await import('googleapis');
      const { createOAuthClient } = await import('../src/auth.js');
      if (process.platform === 'darwin') {
        createOAuthClient();
        expect(execFileSync).toHaveBeenCalledWith(
          'security',
          ['find-generic-password', '-s', 'google-workspace-mcp', '-a', 'client-secret', '-w'],
          expect.anything(),
        );
        expect(google.auth.OAuth2).toHaveBeenCalledWith('test-client-id', 'keychain-secret', undefined);
      } else {
        expect(() => createOAuthClient()).toThrow('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
        expect(execFileSync).not.toHaveBeenCalled();
      }
    });

    it('prefers the env secret over the Keychain', async () => {
      const { createOAuthClient } = await import('../src/auth.js');
      createOAuthClient();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('returns OAuth2 client when env vars are present', async () => {
      const { createOAuthClient } = await import('../src/auth.js');
      const client = createOAuthClient();
      expect(client).toBeDefined();
    });
  });
});
