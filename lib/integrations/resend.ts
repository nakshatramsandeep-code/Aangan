import { config } from '../config';
import { describeSlot } from '../scheduling';
import type { CallRow, EmailResult } from '../types';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const validEmail = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;

/**
 * The confirmation a customer gets after a qualified call. It says what we noted and what happens next.
 * It never contains a price, and it only names a time when a real calendar hold exists.
 */
export function buildEmail(call: CallRow): { subject: string; html: string; text: string } {
  const f = call.fields ?? {};
  const first = (f.name ?? '').split(/\s+/)[0] || 'there';
  const noted: [string, string | undefined][] = [
    ['Project', [f.project_type, f.scope].filter(Boolean).join(': ') || undefined],
    ['Location', f.locality],
    ['Size', f.area_sqft ? `${f.area_sqft.toLocaleString('en-IN')} sq ft` : undefined],
    ['Timeline', f.completion_date],
  ];
  const lines = noted.filter(([, v]) => v) as [string, string][];
  const when = call.consultation?.start ? describeSlot(new Date(call.consultation.start)) : '';
  const next = when
    ? `One of our designers will call you on <b>${esc(when)}</b> to talk through your project. That time is tentative: if it does not suit you, just reply to this email and we will find another.`
    : 'One of our designers will call you shortly to arrange a time that suits you.';
  const nextText = when
    ? `One of our designers will call you on ${when} to talk through your project. That time is tentative: if it does not suit you, just reply to this email and we will find another.`
    : 'One of our designers will call you shortly to arrange a time that suits you.';

  const html = `<!doctype html><html><body style="margin:0;background:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1a17">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#b4512d;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:600">Aangan Studio</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 14px;font-size:16px">Hi ${esc(first)},</p>
<p style="margin:0 0 18px;line-height:1.55">Thank you for calling Aangan Studio. We have passed your enquiry to our design team, so you will not need to repeat yourself.</p>
${lines.length ? `<p style="margin:0 0 6px;font-weight:600">What we noted</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;font-size:14px;line-height:1.5">${lines.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#7b786f">${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
<p style="margin:0 0 6px;font-weight:600">What happens next</p>
<p style="margin:0 0 18px;line-height:1.55">${next}</p>
<p style="margin:0 0 18px;line-height:1.55;color:#4b4943">Pricing depends on the site, the materials and the scope, so your designer will walk you through it at the consultation, which is free.</p>
<p style="margin:0">Warm regards,<br>Aangan Studio, Pune</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `Hi ${first},`, '',
    'Thank you for calling Aangan Studio. We have passed your enquiry to our design team, so you will not need to repeat yourself.', '',
    ...(lines.length ? ['What we noted', ...lines.map(([k, v]) => `  ${k}: ${v}`), ''] : []),
    'What happens next', nextText, '',
    'Pricing depends on the site, the materials and the scope, so your designer will walk you through it at the consultation, which is free.', '',
    'Warm regards,', 'Aangan Studio, Pune',
  ].join('\n');

  return { subject: 'Thanks for calling Aangan Studio', html, text };
}

/** Sends the confirmation. `mock` is forced for test callers so tests never email a real address. */
export async function sendConfirmation(call: CallRow, opts: { mock: boolean }): Promise<EmailResult> {
  const to = call.fields?.email?.trim().toLowerCase();
  if (!validEmail(to)) return { sent: false, mock: false, skipped: 'The caller gave no usable email address' };
  const at = new Date().toISOString();
  if (opts.mock || !config.resend.key) return { sent: true, mock: true, to, at };

  const { subject, html, text } = buildEmail(call);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${config.resend.key}`,
      'content-type': 'application/json',
      // One email per call even if the webhook is delivered or retried several times.
      'Idempotency-Key': `aangan-confirm-${call.id}`,
    },
    body: JSON.stringify({ from: config.resend.from, to: [to], subject, html, text, ...(config.resend.replyTo ? { reply_to: config.resend.replyTo } : {}) }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { sent: false, mock: false, to, error: `Resend ${res.status}: ${j.message ?? j.error ?? 'failed'}`.slice(0, 220) };
  return { sent: true, mock: false, to, id: String(j.id), at };
}
