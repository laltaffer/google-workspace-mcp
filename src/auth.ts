import { google } from 'googleapis';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import os from 'os';
import type { AddressInfo } from 'net';

export const TOKENS_PATH = path.join(os.homedir(), '.google-workspace-mcp', 'tokens.json');

// Broad scopes are required because drive_list and drive_search need access
// to all user files, not just files created by this app. If you only need
// access to files this app creates, change drive to drive.file.
const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
];

export const KEYCHAIN_SERVICE = 'google-workspace-mcp';
export const KEYCHAIN_ACCOUNT = 'client-secret';

// Reads the OAuth client secret from the macOS Keychain so it never has to sit
// in an MCP config file. Returns undefined on other platforms or if no entry exists.
function readSecretFromKeychain(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function createOAuthClient(redirectUri?: string): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || readSecretFromKeychain();
  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required (the secret may also come from the macOS Keychain, service google-workspace-mcp)',
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export const KEYCHAIN_TOKENS_ACCOUNT = 'tokens';

// Tokens live in the macOS Keychain by default on darwin and in a 0600 file
// elsewhere. GOOGLE_WORKSPACE_MCP_TOKEN_STORE=file|keychain overrides.
function useKeychain(): boolean {
  const override = process.env.GOOGLE_WORKSPACE_MCP_TOKEN_STORE;
  if (override === 'file') return false;
  if (override === 'keychain') return true;
  return process.platform === 'darwin';
}

function keychainRead(): object | null {
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_TOKENS_ACCOUNT, '-w'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out ? JSON.parse(Buffer.from(out, 'base64').toString('utf-8')) : null;
  } catch {
    return null;
  }
}

// Writes through `security -i` so the token never appears in argv or `ps`.
// Base64 keeps the JSON free of shell-quoting concerns in the command line.
function keychainWrite(tokens: object): void {
  const b64 = Buffer.from(JSON.stringify(tokens)).toString('base64');
  execFileSync('security', ['-i'], {
    input: `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_TOKENS_ACCOUNT} -w ${b64}\n`,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

function keychainDelete(): void {
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_TOKENS_ACCOUNT],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
  } catch {
    // No entry to delete.
  }
}

async function fileRead(): Promise<object | null> {
  try {
    return JSON.parse(await fs.readFile(TOKENS_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

async function fileDelete(): Promise<void> {
  try {
    await fs.unlink(TOKENS_PATH);
  } catch {
    // Nothing to delete.
  }
}

export async function loadTokens(): Promise<object | null> {
  if (!useKeychain()) return fileRead();
  const fromKeychain = keychainRead();
  if (fromKeychain) return fromKeychain;
  // One-time migration from the pre-Keychain file store.
  const legacy = await fileRead();
  if (!legacy) return null;
  keychainWrite(legacy);
  await fileDelete();
  return legacy;
}

export async function saveTokens(tokens: object): Promise<void> {
  if (useKeychain()) {
    keychainWrite(tokens);
    return;
  }
  await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

// One credential per Google account, keyed by lowercase email. `default` is
// the account tools act as when no account argument is given.
export interface TokenStore {
  default?: string;
  accounts: Record<string, Credentials>;
}

async function deleteAllTokens(): Promise<void> {
  if (useKeychain()) keychainDelete();
  await fileDelete();
}

async function revokeToken(refreshToken?: string | null): Promise<void> {
  if (!refreshToken) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // Already revoked or offline; removing the credential is what matters.
  }
}

// Asks Drive which account a credential belongs to. Covered by the drive
// scope, so no extra consent is needed.
export async function resolveEmail(client: OAuth2Client): Promise<string> {
  const res = await google.drive({ version: 'v3', auth: client }).about.get({ fields: 'user(emailAddress)' });
  const email = res.data.user?.emailAddress;
  if (!email) throw new Error('Google did not return an email address for this account.');
  return email.toLowerCase();
}

export async function loadStore(): Promise<TokenStore> {
  const raw = (await loadTokens()) as (TokenStore & Credentials) | null;
  if (!raw) return { accounts: {} };
  if (raw.accounts) return raw;
  // Pre-multi-account shape: one bare credential. Find out whose it is and
  // rewrite it as a one-account store. If the credential is dead, it is
  // left alone and the next authorize overwrites it.
  try {
    const client = createOAuthClient();
    client.setCredentials(raw);
    const email = await resolveEmail(client);
    const store: TokenStore = { default: email, accounts: { [email]: raw } };
    await saveTokens(store);
    return store;
  } catch {
    return { accounts: {} };
  }
}

export async function saveAccount(email: string, tokens: Credentials): Promise<void> {
  const store = await loadStore();
  const key = email.toLowerCase();
  store.accounts[key] = { ...store.accounts[key], ...tokens };
  store.default ??= key;
  await saveTokens(store);
}

// Revokes one account's refresh token at Google (best effort) and removes it
// from the store. When no accounts remain, the store itself is deleted so no
// dead credential is left behind.
export async function removeAccount(email: string): Promise<void> {
  const store = await loadStore();
  const key = email.toLowerCase();
  await revokeToken(store.accounts[key]?.refresh_token);
  delete store.accounts[key];
  const remaining = Object.keys(store.accounts);
  if (remaining.length === 0) {
    await deleteAllTokens();
    return;
  }
  if (store.default === key) store.default = remaining[0];
  await saveTokens(store);
}

// The account a tool call acts as, set per call by withAccount so tool code
// never has to thread it through.
const currentAccount = new AsyncLocalStorage<string | undefined>();

export function withAccount<T>(account: string | undefined, fn: () => T): T {
  return currentAccount.run(account?.toLowerCase(), fn);
}

// Turns Google's bare refresh failure into an actionable message. Tool error
// handlers run every caught error through this.
export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid_grant|invalid_rapt|Token has been expired or revoked/i.test(msg)) {
    return 'Stored credentials have expired or been revoked. Run the authorize tool (with the same account argument) to sign in again.';
  }
  return msg;
}

// Checks that stored credentials still work by refreshing the access token if
// needed and asking Google whether it is live. Returns false on invalid_grant
// (e.g. the refresh token was revoked) or any other auth failure.
export async function validateCredentials(client: OAuth2Client): Promise<boolean> {
  try {
    const { token } = await client.getAccessToken();
    if (!token) return false;
    await client.getTokenInfo(token);
    return true;
  } catch {
    return false;
  }
}

// Returns a client for the account set by withAccount, or the default
// account. Null means nothing is authorized yet.
export async function getAuthenticatedClient(): Promise<OAuth2Client | null> {
  const store = await loadStore();
  const email = currentAccount.getStore() ?? store.default;
  if (!email) return null;
  const tokens = store.accounts[email];
  if (!tokens) {
    const known = Object.keys(store.accounts).join(', ') || 'none';
    throw new Error(
      `No stored credentials for ${email}. Authorized accounts: ${known}. Run authorize with account "${email}" to add it.`,
    );
  }
  const client = createOAuthClient();
  client.setCredentials(tokens);
  // Persist refreshed tokens automatically
  client.on('tokens', (newTokens) => saveAccount(email, newTokens));
  return client;
}

// Starts a local HTTP server on a random available port bound to localhost only.
// Returns the auth URL. Token is saved when the user completes the OAuth flow.
export async function startAuthFlow(loginHint?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const redirectUri = `http://localhost:${port}/callback`;
      const client = createOAuthClient(redirectUri);
      const state = crypto.randomBytes(32).toString('hex');

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        // select_account lets the user pick which Google account to add.
        prompt: 'consent select_account',
        state,
        ...(loginHint ? { login_hint: loginHint } : {}),
      });

      server.on('request', async (req, res) => {
        const url = new URL(req.url!, `http://localhost:${port}`);
        const secHeaders = {
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
        };

        if (url.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain', ...secHeaders });
          res.end('Not found');
          return;
        }

        if (url.searchParams.get('state') !== state) {
          res.writeHead(403, { 'Content-Type': 'text/plain', ...secHeaders });
          res.end('Invalid state parameter');
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain', ...secHeaders });
          res.end('Missing authorization code');
          return;
        }

        try {
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          const email = await resolveEmail(client);
          await saveAccount(email, tokens);
          res.writeHead(200, { 'Content-Type': 'text/plain', ...secHeaders });
          res.end(`Authorization complete for ${email}. You can close this tab and return to Claude.`);
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain', ...secHeaders });
          res.end('Authorization failed. Please try again.');
        } finally {
          server.close();
        }
      });

      // Auto-close after 5 minutes
      const timeout = setTimeout(() => {
        if (server.listening) server.close();
      }, 5 * 60 * 1000);
      server.on('close', () => clearTimeout(timeout));

      resolve(authUrl);
    });

    server.on('error', reject);
  });
}
