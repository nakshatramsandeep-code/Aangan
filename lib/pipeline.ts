import { config } from './config';
import { aiCostInr, voiceCostInr } from './cost';
import { getCall, saveCall } from './db';
import { detectPriceLeak } from './guardrails';
import { isAfterHours } from './hours';
import { holdConsultation, isTestCall } from './consultation';
import { createLead, logMeeting } from './integrations/hubspot';
import { sendConfirmation } from './integrations/resend';
import { sendHandoff } from './integrations/telegram';
import { decideRoute, splitTranscript, triage } from './triage';
import type { CallRow, RouteDecision, TriageResult } from './types';

interface Ident {
  callId: string;
  callerNumber?: string;
  startedAt?: string;
  simulated?: boolean;
}

async function loadOrCreate(i: Ident): Promise<CallRow> {
  const existing = await getCall(i.callId);
  if (existing) return existing;
  const started = i.startedAt ? new Date(i.startedAt) : new Date();
  return {
    id: i.callId,
    created_at: started.toISOString(),
    status: 'in_progress',
    caller_number: i.callerNumber,
    after_hours: isAfterHours(started),
    flags: [],
    simulated: i.simulated,
  };
}

/** Gemini sometimes returns the word for a missing value instead of leaving the field out. */
const EMPTY = new Set(['', 'none', 'null', 'n/a', 'na', 'unknown', 'not stated', 'not mentioned', 'undefined']);

function apply(row: CallRow, t: TriageResult, d: RouteDecision) {
  row.fields = { ...row.fields, ...Object.fromEntries(Object.entries(t.fields).filter(([, v]) => v != null && !EMPTY.has(String(v).trim().toLowerCase()))) };
  row.criteria = t.criteria;
  row.complaint = t.complaint;
  row.summary = t.summary;
  row.route = d.route;
  row.flags = [...d.flags];
  // Gemini failed or was too slow and the rule-based reader took over: say so, because it is less thorough.
  if (t.engine === 'heuristic' && config.gemini.key) row.flags.push('Read by the fallback rules because Gemini was unavailable. Please check the name and details.');
  row.next_question = d.next_question;
  row.engine = t.engine;
  const prev = row.ai_tokens ?? { input: 0, output: 0 };
  row.ai_tokens = { input: prev.input + t.usage.inputTokens, output: prev.output + t.usage.outputTokens };
  row.ai_cost_inr = aiCostInr(row.ai_tokens.input, row.ai_tokens.output);
}

/** call_started: remember who is calling and when, before the transcript exists. */
export async function callStarted(i: Ident) {
  const row = await loadOrCreate(i);
  row.caller_number ||= i.callerNumber;
  await saveCall(row);
  return row;
}

/** /qualify: Vaani calls this mid-call with what the caller has said so far; we return the route. */
export async function qualify(i: Ident & { answers?: Record<string, string>; transcript?: string }) {
  const row = await loadOrCreate(i);
  row.caller_number ||= i.callerNumber;
  row.answers = { ...row.answers, ...i.answers };
  const t = await triage({ answers: row.answers, transcript: i.transcript, asOf: new Date(row.created_at) });
  const decision = decideRoute(t);
  apply(row, t, decision);
  await saveCall(row);
  return { ...decision, criteria: t.criteria, fields: row.fields };
}

const isQualified = (r?: string) => r === 'qualified' || r === 'qualified_flag';

/**
 * What is still outstanding for a call. Vaani redelivers webhooks; a redelivery must not cost another
 * Gemini call, a second deal, a second hold or a second email, but it does retry anything that failed.
 */
function outstanding(r: CallRow): string[] {
  if (r.status !== 'ended') return ['all'];
  if (r.silent) return [];
  if (!r.route) return ['triage'];
  const todo: string[] = [];
  if (!r.alert?.sent) todo.push('alert');
  if (isQualified(r.route)) {
    if (!r.consultation || r.consultation.error) todo.push('hold');
    if (!r.hubspot?.deal_id) todo.push('lead');
    if (r.consultation?.start && r.hubspot?.deal_id && !r.hubspot.meeting_id) todo.push('meeting');
    if (!r.email || r.email.error) todo.push('email');
  }
  return todo;
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 220);

/** /call-ended: log everything, then fan out to the calendar, HubSpot, the customer and Telegram. Safe to call twice. */
export async function callEnded(
  i: Ident & { answers?: Record<string, string>; transcript?: string; durationSec: number; answeredInSec?: number },
) {
  const row = await loadOrCreate(i);
  if (outstanding(row).length === 0) return row;
  // Another delivery of this call is being processed right now (Vaani retried): let it finish.
  if (row.processing_since && Date.now() - new Date(row.processing_since).getTime() < 150_000) return row;
  row.processing_since = new Date().toISOString();
  await saveCall(row);

  row.caller_number ||= i.callerNumber;
  const firstTime = row.status !== 'ended';
  row.status = 'ended';
  row.duration_sec = i.durationSec;
  row.answered_in_sec = i.answeredInSec;
  row.answers = { ...row.answers, ...i.answers };
  const v = voiceCostInr(i.durationSec);
  row.voice_minutes = v.minutes;
  row.voice_cost_inr = v.inr;

  const split = i.transcript ? splitTranscript(i.transcript) : null;
  if (i.transcript) {
    row.transcript = i.transcript;
    const leaks = detectPriceLeak(split!.agent);
    row.price_leak = leaks.length ? leaks : undefined;
  }

  // A call where the caller never spoke is logged and costed, but not triaged, alerted or counted.
  const callerSaid = split?.labelled ? split.caller.join(' ').replace(/\W/g, '').length : Object.keys(row.answers ?? {}).length ? 99 : 0;
  if (callerSaid < 3) {
    row.silent = true;
    row.route = undefined;
    row.summary = 'No conversation: the caller did not speak.';
    row.flags = [];
    row.processing_since = undefined;
    await saveCall(row);
    return row;
  }
  row.silent = false;

  // The full transcript is the final word. Triage runs once; a retry only repeats the steps that failed.
  if (firstTime || !row.route || !row.criteria) {
    const t = await triage({ answers: row.answers, transcript: i.transcript, asOf: new Date(row.created_at) });
    apply(row, t, decideRoute(t));
    await saveCall(row);
  }

  const todo = outstanding(row);
  const test = isTestCall(row);

  // 1. Block the designer's time first, so the deal and the email can name it.
  if (todo.includes('hold')) {
    try { row.consultation = await holdConsultation(row, test); }
    catch (e) { row.consultation = { calendar: 'google', error: errText(e) }; }
  }
  // 2. The deal in HubSpot.
  if (todo.includes('lead')) {
    try { row.hubspot = { ...row.hubspot, ...(await createLead(row)) }; }
    catch (e) { row.hubspot = { ...row.hubspot, mock: false, error: errText(e) }; }
  }
  // 3. Meeting log, customer email and designer note are independent of each other.
  const [meeting, mail, alert] = await Promise.allSettled([
    row.consultation?.start && row.hubspot?.deal_id && !row.hubspot.meeting_id ? logMeeting(row) : Promise.resolve(undefined),
    isQualified(row.route) && (!row.email || row.email.error) ? sendConfirmation(row, { mock: test }) : Promise.resolve(undefined),
    !row.alert?.sent ? sendHandoff(row) : Promise.resolve(undefined),
  ]);
  if (meeting.status === 'fulfilled' && meeting.value && row.hubspot) row.hubspot = { ...row.hubspot, meeting_id: meeting.value, error: undefined };
  if (meeting.status === 'rejected' && row.hubspot) row.hubspot = { ...row.hubspot, error: `Meeting log: ${errText(meeting.reason)}` };
  if (mail.status === 'fulfilled' && mail.value) row.email = mail.value;
  if (mail.status === 'rejected') row.email = { sent: false, mock: false, error: errText(mail.reason) };
  if (alert.status === 'fulfilled' && alert.value) row.alert = alert.value;
  if (alert.status === 'rejected') row.alert = { sent: false, mock: false, error: errText(alert.reason) };

  row.processing_since = undefined;
  await saveCall(row);
  return row;
}
