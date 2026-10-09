import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RoutePill } from '@/components/RoutePill';
import { Topbar } from '@/components/Topbar';
import { getCall } from '@/lib/db';
import { dur, inrExact, when } from '@/lib/format';
import { buildNote } from '@/lib/integrations/telegram';

export const dynamic = 'force-dynamic';

const mark = { pass: '✔', fail: '✘', unclear: '?' } as const;
const color = { pass: 'ok', fail: 'bad', unclear: 'dim' } as const;
const isAgent = (l: string) => /^(\[[\d:]+\]\s*)?(front desk|agent|assistant)\s*:/i.test(l);

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCall(decodeURIComponent(id));
  if (!c) notFound();
  const f = c.fields ?? {};
  const note = buildNote(c).replace(/<a [^>]*>(.*?)<\/a>/g, '$1').replace(/<\/?b>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  return (
    <>
      <Topbar />
      <div className="container">
        <Link href="/" className="back">← All calls</Link>
        <div className="page-title">
          <div>
            <h1>{f.name ?? 'Unknown caller'} <RoutePill route={c.route} /></h1>
            <p className="meta">
              {when(c.created_at)} · {c.caller_number ?? 'no number'} · {dur(c.duration_sec)}
              {c.after_hours && ' · after hours'}
            </p>
          </div>
        </div>

        {c.price_leak && (
          <div className="alert" style={{ marginTop: 0, marginBottom: 12 }}>
            <b>The agent may have quoted a price.</b>
            <ul>{c.price_leak.map((l, i) => <li key={i}>“{l}”</li>)}</ul>
          </div>
        )}
        {c.flags.length > 0 && (
          <div className="flagbox">
            <b>Flags for the designer</b>
            <ul>{c.flags.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}

        <div className="two">
          <div className="card">
            <p className="card-title">Handoff note</p>
            <pre className="note-text">{note}</pre>
          </div>
          <div className="card">
            <p className="card-title">Qualification</p>
            {c.criteria
              ? Object.entries(c.criteria).map(([k, v]) => (
                  <div className="row" key={k}>
                    <span style={{ textTransform: 'capitalize' }}>{k.replace('_', ' ')}</span>
                    <span className={color[v.status]} style={{ textAlign: 'right' }}>{mark[v.status]} {v.note}</span>
                  </div>
                ))
              : <p className="dim">Not evaluated.</p>}
          </div>
        </div>

        <h2>Delivery and cost</h2>
        <div className="two">
          <div className="card">
            <div className="row"><span>Telegram</span><span>{c.alert?.error ? <span className="bad">Failed: {c.alert.error}</span> : c.alert?.sent ? `Sent${c.alert.mock ? ' (mock)' : ''}` : 'Not sent'}</span></div>
            <div className="row"><span>HubSpot</span><span>{c.hubspot?.error ? <span className="bad">Failed: {c.hubspot.error}</span> : c.hubspot?.deal_id ? `Deal ${c.hubspot.deal_id}${c.hubspot.mock ? ' (mock)' : ''}` : 'No deal (not qualified)'}</span></div>
          </div>
          <div className="card">
            <div className="row"><span>Voice</span><span>{c.voice_minutes ?? 0} min · {inrExact(c.voice_cost_inr ?? 0)}</span></div>
            <div className="row"><span>AI triage</span><span>{inrExact(c.ai_cost_inr ?? 0)}</span></div>
            <div className="row total"><span>Total</span><span>{inrExact((c.voice_cost_inr ?? 0) + (c.ai_cost_inr ?? 0))}</span></div>
          </div>
        </div>

        <h2>Transcript</h2>
        <div className="card transcript">
          {c.transcript
            ? c.transcript.split('\n').map((l, i) => <div key={i} className={isAgent(l) ? 'a' : 'c'}>{l}</div>)
            : <span className="dim">No transcript stored.</span>}
        </div>
      </div>
    </>
  );
}
