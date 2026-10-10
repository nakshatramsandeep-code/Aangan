import { createSign } from 'node:crypto';
import { config } from '../config';
import type { Interval } from '../scheduling';

/**
 * Google Calendar, two ways to sign in:
 *  - OAuth refresh token (GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN): acts as the person who
 *    consented once. Needs no key file, so it works where the organization forbids service-account keys.
 *  - Service account (GOOGLE_SERVICE_ACCOUNT_JSON): the designer shares a calendar with its email.
 * Events are tentative holds with no attendees and no invitations, so nobody is emailed by Google.
 * The OAuth scopes are the minimum: create events and read free/busy. Nothing else in the calendar is readable.
 */
export const OAUTH_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'];

interface Creds { client_email: string; private_key: string }

function serviceCreds(): Creds | null {
  const raw = config.google.serviceAccount.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const c = JSON.parse(json);
    return c.client_email && c.private_key ? { client_email: c.client_email, private_key: String(c.private_key).replace(/\\n/g, '\n') } : null;
  } catch {
    return null;
  }
}

const oauthConfigured = () => !!(config.google.oauthClientId && config.google.oauthClientSecret && config.google.oauthRefreshToken);

export type AuthMode = 'oauth' | 'service' | null;
export const authMode = (): AuthMode => (oauthConfigured() ? 'oauth' : serviceCreds() && config.google.calendarId ? 'service' : null);
/** "primary" is the signed-in user's own calendar, the natural default for OAuth. */
const calendarId = () => config.google.calendarId || (oauthConfigured() ? 'primary' : '');
export const gcalLive = () => authMode() !== null && !!calendarId();
export const serviceAccountEmail = () => serviceCreds()?.client_email;

const b64u = (x: Buffer | string) => Buffer.from(x).toString('base64url');

/** A signed JWT for the OAuth "jwt-bearer" grant. Exported so it can be verified in tests. */
export function signJwt(c: Creds, now = Math.floor(Date.now() / 1000)): string {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/calendar', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(c.private_key);
  return `${head}.${claims}.${b64u(sig)}`;
}

let tok: { value: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (tok && tok.exp > Date.now() + 60_000) return tok.value;
  let body: URLSearchParams;
  if (oauthConfigured()) {
    body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.google.oauthRefreshToken, client_id: config.google.oauthClientId, client_secret: config.google.oauthClientSecret });
  } else {
    const c = serviceCreds();
    if (!c) throw new Error('Google Calendar is not configured');
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(c) });
  }
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = j.error === 'invalid_grant' ? ' (the consent was revoked or expired; run the consent step again)' : '';
    throw new Error(`Google sign-in failed (${res.status}): ${j.error_description ?? j.error ?? 'unknown'}${hint}`);
  }
  tok = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return tok.value;
}

async function g(path: string, init?: RequestInit) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${j.error?.message ?? 'request failed'}`);
  return j;
}

const cal = () => encodeURIComponent(calendarId());

export async function busyIntervals(from: Date, to: Date): Promise<Interval[]> {
  const id = calendarId();
  const j = await g('/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: 'Asia/Kolkata', items: [{ id }] }) });
  const c = j.calendars?.[id];
  if (c?.errors?.length) throw new Error(`Google Calendar: ${c.errors[0].reason ?? 'cannot read this calendar'}`);
  return (c?.busy ?? []).map((b: { start: string; end: string }) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function createHold(a: { start: Date; end: Date; summary: string; description: string }) {
  const j = await g(`/calendars/${cal()}/events?sendUpdates=none`, {
    method: 'POST',
    body: JSON.stringify({
      summary: a.summary, description: a.description, status: 'tentative', transparency: 'opaque',
      start: { dateTime: a.start.toISOString(), timeZone: 'Asia/Kolkata' }, end: { dateTime: a.end.toISOString(), timeZone: 'Asia/Kolkata' },
      reminders: { useDefault: true },
    }),
  });
  return { id: String(j.id), link: String(j.htmlLink ?? '') };
}

export async function deleteHold(eventId: string) {
  await g(`/calendars/${cal()}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: 'DELETE' }).catch((e) => {
    if (!/410|404/.test(String(e))) throw e;
  });
}

/** For the status page: can we sign in and read free/busy? Uses only the free/busy scope. */
export async function checkAccess() {
  const now = new Date();
  await busyIntervals(now, new Date(now.getTime() + 3600e3));
  return { name: calendarId() === 'primary' ? 'your primary calendar' : calendarId() };
}
