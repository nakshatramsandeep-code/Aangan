/**
 * One-time Google consent for the calendar (OAuth, no key file).
 *
 *   npm run google:consent
 *
 * Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local (a "Desktop app" OAuth client).
 * Starts a tiny server on http://127.0.0.1:8765, writes the consent URL to google-consent-url.txt (and prints it),
 * waits for Google to redirect back, exchanges the code (PKCE) and saves GOOGLE_OAUTH_REFRESH_TOKEN into
 * .env.local. The token is never printed. Scopes: create events and read free/busy only.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ENV = path.join(process.cwd(), '.env.local');
const env: Record<string, string> = {};
for (const l of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const ID = env.GOOGLE_OAUTH_CLIENT_ID, SECRET = env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!ID || !SECRET) { console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local first.'); process.exit(2); }

const PORT = 8765, REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'];
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');

const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES.join(' '),
  access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
});

function save(key: string, value: string) {
  let text = fs.readFileSync(ENV, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : text.replace(/\s*$/, '\n') + `${key}=${value}\n`;
  fs.writeFileSync(ENV, text);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', REDIRECT);
  if (u.pathname !== '/') { res.writeHead(404).end(); return; }
  const done = (msg: string, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<body style="font-family:system-ui;padding:40px"><h2>${msg}</h2><p>You can close this tab.</p></body>`); };
  if (u.searchParams.get('error')) { done(`Google said: ${u.searchParams.get('error')}`, 400); console.error('Consent refused:', u.searchParams.get('error')); setTimeout(() => process.exit(1), 300); return; }
  if (u.searchParams.get('state') !== state) { done('State mismatch, ignored', 400); return; }
  const code = u.searchParams.get('code');
  if (!code) { done('No code', 400); return; }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: ID, client_secret: SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) {
    done('Could not get a refresh token', 500);
    console.error('Token exchange failed:', r.status, j.error_description ?? j.error ?? 'no refresh token returned');
    setTimeout(() => process.exit(1), 300); return;
  }
  save('GOOGLE_OAUTH_REFRESH_TOKEN', j.refresh_token);
  console.log('Consent received. Refresh token saved to .env.local (not printed). Scopes granted:', j.scope);
  done('Calendar connected');
  setTimeout(() => process.exit(0), 300);
});

server.listen(PORT, '127.0.0.1', () => {
  fs.writeFileSync('google-consent-url.txt', url);
  console.log('Waiting for consent on', REDIRECT);
  console.log('CONSENT_URL_WRITTEN');
});
setTimeout(() => { console.error('Timed out waiting for consent'); process.exit(1); }, 10 * 60 * 1000);
