import { config } from '../config';
import type { CallRow, Route } from '../types';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const HEAD: Record<Route, string> = {
  qualified: '✅ Qualified',
  qualified_flag: '🟡 Qualified, with flags',
  ask_question: '❓ Incomplete: call ended before qualifying',
  close_gracefully: '⚪ Closed gracefully (please review)',
  escalate: '🚨 URGENT: complaint, call back',
};

/** The handoff note: everything already asked, so the designer's first call is the real conversation. */
export function buildNote(call: CallRow): string {
  const f = call.fields ?? {};
  const c = call.criteria;
  const line = (label: string, v?: string | number) => (v ? `<b>${label}:</b> ${esc(v)}\n` : '');
  const mins = call.duration_sec ? `${Math.floor(call.duration_sec / 60)}m ${call.duration_sec % 60}s` : '';
  return (
    `<b>${HEAD[call.route ?? 'ask_question']}</b>${call.after_hours ? ' · after hours' : ''}\n\n` +
    line('Name', f.name) +
    line('Number', call.caller_number) +
    line('Project', [f.project_type, f.scope].filter(Boolean).join(': ')) +
    line('Location', f.locality) +
    line('Area', f.area_sqft ? `${f.area_sqft} sq ft` : undefined) +
    line('Timeline', f.completion_date) +
    line('Budget', f.budget_mentioned) +
    line('Decides', f.decision_maker) +
    (call.booking
      ? `<b>Slot booked:</b> ${esc(new Date(call.booking.start).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }))}\n`
      : call.route === 'qualified' || call.route === 'qualified_flag'
        ? '<b>Consultation:</b> designer to schedule\n'
        : '') +
    (call.flags.length ? `\n⚠️ <b>Flags</b>\n${call.flags.map((x) => `• ${esc(x)}`).join('\n')}\n` : '') +
    (c ? `\n<b>Criteria:</b> ${Object.entries(c).map(([k, v]) => `${v.status === 'pass' ? '✔' : v.status === 'fail' ? '✘' : '?'} ${k.replace('_', ' ')}`).join(' · ')}\n` : '') +
    (call.summary ? `\n${esc(call.summary)}\n` : '') +
    (call.price_leak?.length ? `\n🛑 <b>Agent may have quoted a price. Check the transcript.</b>\n` : '') +
    `\n${mins ? mins + ' · ' : ''}<a href="${config.appUrl}/calls/${esc(call.id)}">Transcript</a>`
  );
}

export async function sendHandoff(call: CallRow): Promise<NonNullable<CallRow['alert']>> {
  if (!config.telegram.token || !config.telegram.chatId) return { sent: true, mock: true, at: new Date().toISOString() };
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text: buildNote(call),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { sent: true, mock: false, at: new Date().toISOString() };
}
