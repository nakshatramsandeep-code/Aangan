import { config } from './config';

/**
 * The only file that knows what Vaani's payloads look like. The real field names are not
 * confirmed yet, so each value is read from several likely keys. When the API docs arrive,
 * adjust the key lists here and nothing else changes.
 */

type Obj = Record<string, any>;
const pick = (o: Obj, keys: string[]): any => {
  for (const k of keys) {
    const v = k.split('.').reduce<any>((a, p) => (a == null ? a : a[p]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

export function authorised(req: Request): boolean {
  if (!config.webhookSecret) return process.env.NODE_ENV !== 'production'; // open in dev only
  // Vaani documents no signature or custom headers for webhooks, so the secret can ride in the URL.
  const given =
    new URL(req.url).searchParams.get('secret') ??
    req.headers.get('x-webhook-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  return given === config.webhookSecret;
}

/** Transcript may arrive as a string or as an array of {role|speaker, text|content|message}. */
function toTranscript(t: unknown): string | undefined {
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    const o = t as Obj;
    return toTranscript(o.messages ?? o.turns ?? o.items ?? o.conversation ?? o.text);
  }
  if (Array.isArray(t)) {
    return t
      .map((m: Obj) => {
        const who = String(m.role ?? m.speaker ?? m.from ?? '').toLowerCase();
        const label = /agent|assistant|bot|ai|vaani/.test(who) ? 'Agent' : 'Caller';
        return `${label}: ${m.text ?? m.content ?? m.message ?? ''}`;
      })
      .join('\n');
  }
  return undefined;
}

export function normalizeQualify(body: Obj) {
  return {
    callId: String(pick(body, ['call_id', 'callId', 'call.id', 'id']) ?? `call-${Date.now()}`),
    callerNumber: pick(body, ['caller_number', 'from', 'caller', 'call.from', 'customer.number']) as string | undefined,
    startedAt: pick(body, ['started_at', 'startedAt', 'call.started_at']) as string | undefined,
    answers: (pick(body, ['answers', 'collected', 'parameters']) ?? {}) as Record<string, string>,
    transcript: toTranscript(pick(body, ['transcript', 'conversation'])),
  };
}

export function normalizeCallEnded(body: Obj) {
  const base = normalizeQualify(body);
  return {
    ...base,
    durationSec: Number(pick(body, ['duration_sec', 'duration_seconds', 'duration', 'call.duration'])) || 0,
    answeredInSec: (() => {
      const v = pick(body, ['answered_in_sec', 'pickup_seconds', 'ring_seconds']);
      return v === undefined ? undefined : Number(v);
    })(),
    endedAt: pick(body, ['ended_at', 'endedAt']) as string | undefined,
  };
}

/**
 * Vaani's `call_postprocessing` webhook: { event, call_id, timestamp, data: { summary, transcript,
 * entities, dispositions, recording_url, call_duration (milliseconds) } }.
 * Field names beyond those are not documented, so caller number etc. are read from likely keys.
 * Every raw payload is also kept (see lib/db.ts logEvent) so the mapping can be checked against reality.
 */
export function normalizePostCall(body: Obj) {
  const d: Obj = body.data ?? {};
  // Docs say milliseconds, Vaani's own test payload says 120 (seconds). Anything above 10,000 can only be ms.
  const rawDur = Number(pick(d, ['call_duration']) ?? pick(body, ['call_duration']));
  const durationSec = Number.isFinite(rawDur) ? Math.round(rawDur > 10000 ? rawDur / 1000 : rawDur) : 0;
  const ts = pick(body, ['timestamp', 'created_at']) as string | number | undefined;
  const ended = ts ? new Date(ts) : undefined;
  const started = ended && !isNaN(ended.getTime()) && durationSec ? new Date(ended.getTime() - durationSec * 1000) : undefined;
  return {
    callId: String(pick(body, ['call_id', 'data.call_id', 'room_name', 'data.room_name']) ?? `call-${Date.now()}`),
    callerNumber: pick(body, [
      'data.contact_number', 'data.caller_number', 'data.from_number', 'data.from', 'data.phone_number',
      'contact_number', 'caller_number', 'from', 'phone_number',
    ]) as string | undefined,
    startedAt: started?.toISOString(),
    durationSec,
    transcript: toTranscript(pick(d, ['transcript']) ?? pick(body, ['transcript'])),
    vaaniSummary: pick(d, ['summary']) as string | undefined,
  };
}

/** `call_started`: { event, timestamp, data: { call_id, room_name, call_type, agent_name, phone_number } }.
 *  This is the only event that carries the caller's number, so we keep it until the transcript arrives. */
export function normalizeCallStarted(body: Obj) {
  const d: Obj = body.data ?? {};
  return {
    callId: String(pick(d, ['call_id', 'room_name']) ?? pick(body, ['call_id']) ?? `call-${Date.now()}`),
    callerNumber: pick(d, ['phone_number', 'contact_number', 'from']) as string | undefined,
    startedAt: pick(body, ['timestamp']) as string | undefined,
  };
}
