import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Mock fs and googleapis before importing auth
vi.mock('fs/promises');
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock'),
        getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'tok', refresh_token: 'ref' } }),
        setCredentials: vi.fn(),
      })),
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
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(TOKENS_PATH), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        TOKENS_PATH,
        expect.stringContaining('access_token')
      );
    });
  });

  describe('createOAuthClient', () => {
    it('throws if env vars are missing', async () => {
      vi.unstubAllEnvs();
      const { createOAuthClient } = await import('../src/auth.js');
      expect(() => createOAuthClient()).toThrow('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
    });

    it('returns OAuth2 client when env vars are present', async () => {
      const { createOAuthClient } = await import('../src/auth.js');
      const client = createOAuthClient();
      expect(client).toBeDefined();
    });
  });
});
