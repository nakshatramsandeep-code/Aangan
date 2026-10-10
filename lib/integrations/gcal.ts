import { createSign } from 'node:crypto';
import { config } from '../config';
import type { Interval } from '../scheduling';

/**
 * Google Calendar through a service account: no browser sign-in, no refresh tokens. The designer shares
 * their calendar with the service account's email ("Make changes to events") and sets GOOGLE_CALENDAR_ID.
 * Events are tentative holds with no attendees and no invitations, so nobody is emailed by Google.
 */

interface Creds { client_email: string; private_key: string }

function creds(): Creds | null {
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

export const gcalLive = () => !!creds() && !!config.google.calendarId;
export const serviceAccountEmail = () => creds()?.client_email;

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
  const c = creds();
  if (!c) throw new Error('Google service account is not configured');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(c) }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}): ${j.error_description ?? j.error ?? 'unknown'}`);
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

const cal = () => encodeURIComponent(config.google.calendarId);

export async function busyIntervals(from: Date, to: Date): Promise<Interval[]> {
  const j = await g('/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: 'Asia/Kolkata', items: [{ id: config.google.calendarId }] }) });
  const c = j.calendars?.[config.google.calendarId];
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

/** For the status page: can we sign in and see the calendar? */
export async function checkAccess() {
  const j = await g(`/calendars/${cal()}`);
  return { name: String(j.summary ?? config.google.calendarId) };
}
