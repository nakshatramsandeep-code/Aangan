import { aiCostInr, voiceCostInr } from './cost';
import { getCall, saveCall } from './db';
import { detectPriceLeak } from './guardrails';
import { isAfterHours } from './hours';
import { createLead } from './integrations/hubspot';
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
  row.flags = d.flags;
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

/** /call-ended: log everything, then fan out to Telegram and HubSpot. Safe to call twice. */
export async function callEnded(
  i: Ident & { answers?: Record<string, string>; transcript?: string; durationSec: number; answeredInSec?: number },
) {
  const row = await loadOrCreate(i);
  row.caller_number ||= i.callerNumber;
  row.status = 'ended';
  row.duration_sec = i.durationSec;
  row.answered_in_sec = i.answeredInSec;
  row.answers = { ...row.answers, ...i.answers };
  if (i.transcript) {
    row.transcript = i.transcript;
    const { agent } = splitTranscript(i.transcript);
    const leaks = detectPriceLeak(agent);
    row.price_leak = leaks.length ? leaks : undefined;
  }
  const v = voiceCostInr(i.durationSec);
  row.voice_minutes = v.minutes;
  row.voice_cost_inr = v.inr;

  // The full transcript is the final word; it overrides whatever was decided mid-call.
  if (i.transcript || Object.keys(row.answers ?? {}).length) {
    const t = await triage({ answers: row.answers, transcript: i.transcript, asOf: new Date(row.created_at) });
    apply(row, t, decideRoute(t));
  } else {
    row.route ??= 'ask_question';
  }
  await saveCall(row);

  // A call too short to have said anything (dropped line) is logged but not sent to a designer.
  const hasContent = !!(i.transcript || Object.keys(row.answers ?? {}).length) && (row.fields?.name || row.fields?.scope || row.route === 'escalate' || row.fields?.locality);
  const wantsHubspot = (row.route === 'qualified' || row.route === 'qualified_flag') && !row.hubspot?.deal_id;
  const wantsAlert = hasContent && !row.alert?.sent;

  const [alert, lead] = await Promise.allSettled([
    wantsAlert ? sendHandoff(row) : Promise.resolve(undefined),
    wantsHubspot ? createLead(row) : Promise.resolve(undefined),
  ]);
  if (alert.status === 'fulfilled' && alert.value) row.alert = alert.value;
  if (alert.status === 'rejected') row.alert = { sent: false, mock: false, error: String(alert.reason?.message ?? alert.reason) };
  if (lead.status === 'fulfilled' && lead.value) row.hubspot = lead.value;
  if (lead.status === 'rejected') row.hubspot = { mock: false, error: String(lead.reason?.message ?? lead.reason) };
  await saveCall(row);
  return row;
}
