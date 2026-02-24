import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
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

export function createOAuthClient(redirectUri?: string): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars are required');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function loadTokens(): Promise<object | null> {
  try {
    const data = await fs.readFile(TOKENS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: object): Promise<void> {
  await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export async function getAuthenticatedClient(): Promise<OAuth2Client | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  const client = createOAuthClient();
  client.setCredentials(tokens);
  // Persist refreshed tokens automatically
  client.on('tokens', async (newTokens) => {
    const existing = await loadTokens() ?? {};
    await saveTokens({ ...existing, ...newTokens });
  });
  return client;
}

// Starts a local HTTP server on a random available port bound to localhost only.
// Returns the auth URL. Token is saved when the user completes the OAuth flow.
export async function startAuthFlow(): Promise<string> {
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
        prompt: 'consent',
        state,
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
          await saveTokens(tokens);
          res.writeHead(200, { 'Content-Type': 'text/html', ...secHeaders });
          res.end('<h2>Authorization complete! You can close this tab and return to Claude.</h2>');
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
