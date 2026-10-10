import { neon } from '@neondatabase/serverless';
import { config } from './config';
import { checkAccess, gcalLive } from './integrations/gcal';
import type { LoggedEvent } from './db';
import type { CallRow } from './types';

export type Health = 'ok' | 'warn' | 'down' | 'off';
export interface Check {
  id: 'vaani' | 'app' | 'gemini' | 'neon' | 'calendar' | 'hubspot' | 'email' | 'telegram';
  name: string;
  role: string; // what this stage does in the pipeline
  status: Health;
  detail: string;
  ms?: number;
}

const T = 5000;
const timed = async <R,>(fn: () => Promise<R>): Promise<{ r?: R; err?: string; ms: number }> => {
  const t0 = Date.now();
  try {
    return { r: await fn(), ms: Date.now() - t0 };
  } catch (e) {
    const err = e as Error;
    return { err: err.name === 'TimeoutError' ? 'Timed out after 5 s' : err.message, ms: Date.now() - t0 };
  }
};
const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, signal: AbortSignal.timeout(T), cache: 'no-store' });

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

/** Newest first. Only calls where the caller spoke: those are the ones that go through every stage. */
const recent = (calls: CallRow[]) => calls.filter((c) => c.status === 'ended' && !c.silent && c.route).slice(0, 10);

async function vaani(events: LoggedEvent[]): Promise<Check> {
  const base = { id: 'vaani' as const, name: 'Vaani', role: 'Answers the call' };
  const real = events.filter((e) => e.event && e.event !== 'webhook_test');
  const last = real[0];
  if (!config.webhookSecret) return { ...base, status: 'warn', detail: 'Webhook secret not set, so the endpoint is closed to Vaani' };
  if (!last) return { ...base, status: 'warn', detail: 'No call received yet. Add the webhook URL in Vaani and make a test call' };
  if (!last.ok) return { ...base, status: 'down', detail: `Last event (${last.event}) failed ${ago(last.at)}: ${last.note ?? 'error'}` };
  return { ...base, status: 'ok', detail: `Last event ${last.event} ${ago(last.at)}` };
}

function app(): Check {
  const env = process.env.VERCEL_ENV;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return {
    id: 'app', name: 'Webhook', role: 'Receives the call data (Vercel)', status: 'ok',
    detail: env ? `Serving ${env}${sha ? ` · commit ${sha}` : ''}${process.env.VERCEL_REGION ? ` · ${process.env.VERCEL_REGION}` : ''}` : 'Running locally',
  };
}

async function gemini(calls: CallRow[]): Promise<Check> {
  const base = { id: 'gemini' as const, name: 'Gemini', role: 'Judges the five criteria' };
  if (!config.gemini.key) return { ...base, status: 'off', detail: 'No key, using the rule-based fallback' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`;
  const { r, err, ms } = await timed(() =>
    fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(T), cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word ok.' }] }], generationConfig: { maxOutputTokens: 16 } }),
    }),
  );
  if (err) return { ...base, status: 'down', detail: err, ms };
  if (!r!.ok) {
    const why = r!.status === 429 ? 'Quota exceeded' : r!.status === 404 ? `Model ${config.gemini.model} not available` : r!.status === 400 || r!.status === 403 ? 'Key rejected' : `HTTP ${r!.status}`;
    return { ...base, status: 'down', detail: `${why}. Calls fall back to the rule-based triage`, ms };
  }
  const last = recent(calls)[0];
  if (last && last.engine === 'heuristic') return { ...base, status: 'warn', detail: `Reachable, but the latest call used the fallback (${config.gemini.model})`, ms };
  return { ...base, status: 'ok', detail: config.gemini.model, ms };
}

async function neonCheck(calls: CallRow[]): Promise<Check> {
  const base = { id: 'neon' as const, name: 'Neon', role: 'Stores the call log' };
  if (!config.databaseUrl) return { ...base, status: 'off', detail: 'No DATABASE_URL, using a local file' };
  const { r, err, ms } = await timed(() => neon(config.databaseUrl).query('select count(*)::int as n from calls'));
  if (err) return { ...base, status: 'down', detail: err.includes('does not exist') ? 'Connected, table not created yet' : err, ms };
  return { ...base, status: 'ok', detail: `${(r as { n: number }[])[0]?.n ?? calls.length} calls stored`, ms };
}

async function telegram(calls: CallRow[]): Promise<Check> {
  const base = { id: 'telegram' as const, name: 'Telegram', role: 'Tells the designer' };
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return { ...base, status: 'off', detail: 'Not configured, notes are mocked' };
  const { r, err, ms } = await timed(async () => {
    const [me, chat] = await Promise.all([get(`https://api.telegram.org/bot${token}/getMe`), get(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`)]);
    return { me: await me.json(), chat: await chat.json() };
  });
  if (err) return { ...base, status: 'down', detail: err, ms };
  if (!r!.me.ok) return { ...base, status: 'down', detail: 'Bot token rejected', ms };
  if (!r!.chat.ok) return { ...base, status: 'down', detail: `Bot cannot see the group: ${r!.chat.description ?? 'chat not found'}`, ms };
  const rec = recent(calls);
  const failed = rec.filter((c) => c.alert?.error).length;
  const latest = rec[0];
  if (latest?.alert?.error) return { ...base, status: 'warn', detail: `Reachable, but the latest note failed: ${latest.alert.error.slice(0, 80)}`, ms };
  return { ...base, status: 'ok', detail: `@${r!.me.result.username} → ${r!.chat.result.title}${failed ? ` · ${failed} earlier failure${failed > 1 ? 's' : ''}` : ''}`, ms };
}

async function hubspot(calls: CallRow[]): Promise<Check> {
  const base = { id: 'hubspot' as const, name: 'HubSpot', role: 'Creates the deal' };
  if (!config.hubspot.token) return { ...base, status: 'off', detail: 'Not configured, deals are mocked' };
  const { r, err, ms } = await timed(() => get('https://api.hubapi.com/crm/v3/objects/deals?limit=1', { Authorization: `Bearer ${config.hubspot.token}` }));
  if (err) return { ...base, status: 'down', detail: err, ms };
  if (!r!.ok) return { ...base, status: 'down', detail: r!.status === 401 ? 'Token rejected' : r!.status === 403 ? 'Token is missing deal permissions' : `HTTP ${r!.status}`, ms };
  const q = recent(calls).filter((c) => c.route === 'qualified' || c.route === 'qualified_flag');
  const failed = q.filter((c) => c.hubspot?.error).length;
  if (q[0]?.hubspot?.error) return { ...base, status: 'warn', detail: `Reachable, but the latest deal failed: ${q[0].hubspot.error.slice(0, 80)}`, ms };
  return { ...base, status: 'ok', detail: `Deals pipeline reachable${failed ? ` · ${failed} earlier failure${failed > 1 ? 's' : ''}` : ''}`, ms };
}


async function calendar(calls: CallRow[]): Promise<Check> {
  const base = { id: 'calendar' as const, name: 'Google Calendar', role: 'Blocks the designer’s time' };
  if (!gcalLive()) return { ...base, status: 'off', detail: config.google.serviceAccount ? 'Calendar ID is missing' : 'Not connected: no time is blocked or promised' };
  const { r, err, ms } = await timed(() => checkAccess());
  if (err) return { ...base, status: 'down', detail: /404|not found/i.test(err) ? 'Calendar not found, or not shared with the service account' : err.slice(0, 120), ms };
  const latest = recent(calls).find((c) => c.route === 'qualified' || c.route === 'qualified_flag');
  if (latest?.consultation?.error) return { ...base, status: 'warn', detail: `Reachable, but the latest hold failed: ${latest.consultation.error.slice(0, 80)}`, ms };
  return { ...base, status: 'ok', detail: `Can see “${r!.name}”`, ms };
}

async function email(calls: CallRow[]): Promise<Check> {
  const base = { id: 'email' as const, name: 'Resend', role: 'Emails the customer' };
  if (!config.resend.key) return { ...base, status: 'off', detail: 'Not configured: confirmations are mocked' };
  const { r, err, ms } = await timed(() => get('https://api.resend.com/domains', { Authorization: `Bearer ${config.resend.key}` }));
  if (err) return { ...base, status: 'down', detail: err, ms };
  const body: any = await r!.json().catch(() => ({}));
  // A send-only key is valid but may not list domains; that is not a failure.
  if (r!.status === 401 && body?.name === 'restricted_api_key') return { ...base, status: 'ok', detail: 'Send-only key (domains cannot be checked)', ms };
  if (!r!.ok) return { ...base, status: 'down', detail: r!.status === 401 || r!.status === 403 ? 'API key rejected' : `HTTP ${r!.status}`, ms };
  const verified: string[] = (body.data ?? []).filter((d: any) => d.status === 'verified').map((d: any) => d.name);
  const fromDomain = config.resend.from.match(/@([^>\s]+)/)?.[1] ?? '';
  const sandbox = fromDomain === 'resend.dev';
  if (!verified.length || sandbox) return { ...base, status: 'warn', detail: 'No verified sending domain: Resend will only deliver to the account owner. Verify a domain in Resend and set RESEND_FROM', ms };
  if (!verified.includes(fromDomain)) return { ...base, status: 'warn', detail: `RESEND_FROM uses ${fromDomain}, which is not verified in Resend`, ms };
  const latest = recent(calls).find((c) => c.email && !c.email.skipped);
  if (latest?.email?.error) return { ...base, status: 'warn', detail: `Reachable, but the latest email failed: ${latest.email.error.slice(0, 80)}`, ms };
  return { ...base, status: 'ok', detail: `Sending from ${fromDomain}`, ms };
}

let cache: { at: number; sig: string; out: Check[] } | null = null;

/** Live checks, in pipeline order. Cached for 60 s so a busy dashboard does not hammer the providers. */
export async function runChecks(calls: CallRow[], events: LoggedEvent[], fresh = false): Promise<Check[]> {
  const sig = `${calls[0]?.id}:${calls.length}:${events[0]?.at}`;
  if (!fresh && cache && Date.now() - cache.at < 60_000 && cache.sig === sig) return cache.out;
  const out = await Promise.all([vaani(events), Promise.resolve(app()), gemini(calls), neonCheck(calls), calendar(calls), hubspot(calls), email(calls), telegram(calls)]);
  cache = { at: Date.now(), sig, out };
  return out;
}

export const overall = (c: Check[]) => (c.some((x) => x.status === 'down') ? 'down' : c.some((x) => x.status === 'warn') ? 'warn' : 'ok') as Health;
