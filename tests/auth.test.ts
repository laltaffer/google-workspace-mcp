import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Mock fs and googleapis before importing auth
vi.mock('fs/promises');
vi.mock('child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('googleapis', () => ({
  google: {
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

  describe('describeError', () => {
    it('rewrites invalid_grant into an authorize hint', async () => {
      const { describeError } = await import('../src/auth.js');
      expect(describeError(new Error('invalid_grant'))).toContain('authorize');
      expect(describeError(new Error('Requested entity was not found.'))).toBe('Requested entity was not found.');
    });
  });

  describe('clearTokens', () => {
    it('revokes the refresh token and deletes the tokens file', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ refresh_token: 'ref' }));
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const { clearTokens } = await import('../src/auth.js');
      await clearTokens();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(String(fetchMock.mock.calls[0][1].body)).toBe('token=ref');
      expect(fs.unlink).toHaveBeenCalledWith(TOKENS_PATH);
      vi.unstubAllGlobals();
    });

    it('still deletes the file when revocation fails', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ refresh_token: 'ref' }));
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      const { clearTokens } = await import('../src/auth.js');
      await expect(clearTokens()).resolves.toBeUndefined();
      expect(fs.unlink).toHaveBeenCalledWith(TOKENS_PATH);
      vi.unstubAllGlobals();
    });

    it('does not throw when there is no tokens file', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.unlink).mockRejectedValue(new Error('ENOENT'));
      const { clearTokens } = await import('../src/auth.js');
      await expect(clearTokens()).resolves.toBeUndefined();
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

    it('falls back to the macOS Keychain when the secret env var is unset', async () => {
      vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
      vi.mocked(execFileSync).mockReturnValue('keychain-secret\n' as any);
      const { google } = await import('googleapis');
      const { createOAuthClient } = await import('../src/auth.js');
      createOAuthClient();
      if (process.platform === 'darwin') {
        expect(execFileSync).toHaveBeenCalledWith(
          'security',
          ['find-generic-password', '-s', 'google-workspace-mcp', '-a', 'client-secret', '-w'],
          expect.anything(),
        );
        expect(google.auth.OAuth2).toHaveBeenCalledWith('test-client-id', 'keychain-secret', undefined);
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
