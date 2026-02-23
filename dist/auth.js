import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import os from 'os';
export const TOKENS_PATH = path.join(os.homedir(), '.google-workspace-mcp', 'tokens.json');
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
];
export function createOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars are required');
    }
    return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}
export async function loadTokens() {
    try {
        const data = await fs.readFile(TOKENS_PATH, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
export async function saveTokens(tokens) {
    await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
    await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}
export async function getAuthenticatedClient() {
    const tokens = await loadTokens();
    if (!tokens)
        return null;
    const client = createOAuthClient();
    client.setCredentials(tokens);
    return client;
}
// Starts a local HTTP server, returns the auth URL immediately.
// Token is saved in the background when the user completes the OAuth flow.
export function startAuthFlow() {
    const client = createOAuthClient();
    const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        const code = url.searchParams.get('code');
        if (!code)
            return;
        try {
            const { tokens } = await client.getToken(code);
            await saveTokens(tokens);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h2>Authorization complete! You can close this tab and return to Claude.</h2>');
        }
        catch (err) {
            res.writeHead(500);
            res.end('Authorization failed. Please try again.');
        }
        finally {
            server.close();
        }
    });
    server.listen(REDIRECT_PORT, () => {
        // Server running, waiting for callback
    });
    // Auto-close after 5 minutes if user never completes auth
    setTimeout(() => server.close(), 5 * 60 * 1000);
    return authUrl;
}
