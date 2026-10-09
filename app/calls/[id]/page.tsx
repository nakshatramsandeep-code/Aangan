import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RoutePill } from '@/components/RoutePill';
import { getCall } from '@/lib/db';
import { dur, inrExact, when } from '@/lib/format';
import { buildNote } from '@/lib/integrations/telegram';

export const dynamic = 'force-dynamic';

const mark = { pass: '✔', fail: '✘', unclear: '?' } as const;
const color = { pass: 'ok', fail: 'bad', unclear: 'dim' } as const;

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCall(decodeURIComponent(id));
  if (!c) notFound();
  const f = c.fields ?? {};
  const note = buildNote(c).replace(/<a [^>]*>(.*?)<\/a>/g, '$1').replace(/<\/?b>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  return (
    <>
      <p className="sub"><Link href="/">← All calls</Link></p>
      <h1>{f.name ?? 'Unknown caller'} <RoutePill route={c.route} /></h1>
      <p className="sub">
        {when(c.created_at)} · {c.caller_number ?? 'no number'} · {dur(c.duration_sec)}
        {c.after_hours && ' · after hours'}{c.simulated && ' · simulated'} · triage by {c.engine ?? '-'}
      </p>

      {c.price_leak && (
        <div className="card warn" style={{ marginBottom: 12 }}>
          <b className="bad">The agent may have quoted a price.</b> Lines that matched the never-say patterns:
          <ul>{c.price_leak.map((l, i) => <li key={i}>"{l}"</li>)}</ul>
        </div>
      )}
      {c.flags.length > 0 && (
        <div className="card note" style={{ marginBottom: 12 }}>
          <b>Flags for the designer</b>
          <ul style={{ margin: '4px 0 0' }}>{c.flags.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      <div className="two">
        <div className="card">
          <b>Handoff note (what Telegram sends)</b>
          <pre className="transcript" style={{ margin: '8px 0 0', fontFamily: 'inherit' }}>{note}</pre>
        </div>
        <div className="card">
          <b>Five criteria</b>
          {c.criteria
            ? Object.entries(c.criteria).map(([k, v]) => (
                <div className="row" key={k}>
                  <span>{k.replace('_', ' ')}</span>
                  <span className={color[v.status]} style={{ textAlign: 'right' }}>{mark[v.status]} {v.note}</span>
                </div>
              ))
            : <p className="dim">Not evaluated.</p>}
        </div>
      </div>

      <h2>Log row</h2>
      <div className="two">
        <div className="card">
          <div className="row"><span>Telegram alert</span><span>{c.alert?.error ? <span className="bad">failed: {c.alert.error}</span> : c.alert?.sent ? `Sent${c.alert.mock ? ' (mock)' : ''}` : 'Not sent'}</span></div>
          <div className="row"><span>HubSpot</span><span>{c.hubspot?.error ? <span className="bad">failed: {c.hubspot.error}</span> : c.hubspot?.deal_id ? `Deal ${c.hubspot.deal_id}${c.hubspot.mock ? ' (mock)' : ''}` : 'No deal (not qualified)'}</span></div>
        </div>
        <div className="card">
          <div className="row"><span>Voice</span><span>{c.voice_minutes ?? 0} min · {inrExact(c.voice_cost_inr ?? 0)}</span></div>
          <div className="row"><span>AI</span><span>{c.ai_tokens ? `${c.ai_tokens.input} in / ${c.ai_tokens.output} out` : '-'} · {inrExact(c.ai_cost_inr ?? 0)}</span></div>
          <div className="row"><span>Total</span><span>{inrExact((c.voice_cost_inr ?? 0) + (c.ai_cost_inr ?? 0))}</span></div>
        </div>
      </div>

      <h2>Transcript</h2>
      <div className="card transcript">
        {c.transcript
          ? c.transcript.split('\n').map((l, i) => (
              <div key={i} className={/^(front desk|agent|assistant)\s*:/i.test(l) ? 'a' : 'c'}>{l}</div>
            ))
          : <span className="dim">No transcript stored.</span>}
      </div>
    </>
  );
}
