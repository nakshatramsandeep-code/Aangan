import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icons';
import { RoutePill } from '@/components/RoutePill';
import { Topbar } from '@/components/Topbar';
import { getCall } from '@/lib/db';
import { dur, initials, inrExact, phone, when } from '@/lib/format';
import { buildNote } from '@/lib/integrations/telegram';
import { describeSlot } from '@/lib/scheduling';
import type { CriterionKey } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CRITERIA: Record<CriterionKey, string> = {
  real_project: 'Real project',
  service_area: 'In service area',
  timeline: 'Workable timeline',
  budget: 'Budget',
  decision_maker: 'Decision-maker',
};
const TICK: Record<string, IconName> = { pass: 'check', fail: 'x', unclear: 'help' };

type Msg = { who: 'agent' | 'caller'; time?: string; text: string };

/** Turns "[16:30:45] AGENT: hello" style transcripts into chat messages. Unlabelled lines continue the previous message. */
function parseTranscript(t: string): Msg[] {
  const out: Msg[] = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(agent|assistant|front desk|ai|bot|caller|user|customer)\s*:\s*(.*)$/i);
    if (m) out.push({ who: /agent|assistant|front desk|ai|bot/i.test(m[2]) ? 'agent' : 'caller', time: m[1], text: m[3] });
    else if (out.length) out[out.length - 1].text += `\n${line}`;
    else out.push({ who: 'caller', text: line });
  }
  return out;
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCall(decodeURIComponent(id));
  if (!c) notFound();
  const f = c.fields ?? {};
  const note = buildNote(c).replace(/<a [^>]*>(.*?)<\/a>/g, '$1').replace(/<\/?b>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n+[^\n]*Transcript$/, '');
  const msgs = c.transcript ? parseTranscript(c.transcript) : [];
  const qualified = c.route === 'qualified' || c.route === 'qualified_flag';

  const facts: [string, string | undefined][] = [
    ['Project', [f.project_type, f.scope].filter(Boolean).join(' · ') || undefined],
    ['Location', f.locality],
    ['Size', f.area_sqft ? `${f.area_sqft.toLocaleString('en-IN')} sq ft` : undefined],
    ['Timeline', f.completion_date],
    ['Budget', f.budget_mentioned ?? 'Not mentioned'],
    ['Decision-maker', f.decision_maker],
    ['Phone', phone(c.caller_number) || undefined],
    ['Email', f.email],
    ['Preferred time', f.preferred_time],
  ];

  const tg = c.alert;
  const hs = c.hubspot;
  const cons = c.consultation;
  const em = c.email;

  return (
    <>
      <Topbar />
      <main className="container">
        <Link href="/" className="back"><Icon name="back" size={15} />All calls</Link>

        <div className="page-title">
          <div className="hero-lead">
            <span className={`avatar lg ${f.name ? '' : 'none'}`}>{f.name ? initials(f.name) : <Icon name="user" size={22} />}</span>
            <div>
              <h1>{f.name ?? 'Unknown caller'} <RoutePill route={c.route} silent={c.silent} /></h1>
              <div className="chips">
                <span className="chip"><span className="ico"><Icon name="clock" size={13} /></span>{when(c.created_at)}</span>
                <span className="chip"><span className="ico"><Icon name="phone" size={13} /></span>{phone(c.caller_number) || 'No number'}</span>
                <span className="chip">{dur(c.duration_sec)} long</span>
                {c.after_hours && <span className="chip"><span className="ico"><Icon name="moon" size={13} /></span>After hours</span>}
                {c.simulated && <span className="chip">Simulated</span>}
              </div>
            </div>
          </div>
        </div>

        {c.summary && <p style={{ margin: '0 0 4px', maxWidth: 760, color: 'var(--ink-2)', fontSize: 15 }}>{c.summary}</p>}

        {c.price_leak && (
          <div className="notice bad">
            <span className="ico"><Icon name="alert" size={18} /></span>
            <div><b>The agent may have quoted a price.</b>
              <ul>{c.price_leak.map((l, i) => <li key={i}>“{l}”</li>)}</ul>
            </div>
          </div>
        )}
        {c.flags.length > 0 && (
          <div className="notice warn">
            <span className="ico"><Icon name="flag" size={18} /></span>
            <div><b>For the designer</b><ul>{c.flags.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          </div>
        )}

        <div className="detail">
          <section className="card" aria-labelledby="h-t">
            <div className="card-head"><div><h2 id="h-t" className="card-title">Conversation</h2><p className="card-sub">{msgs.length} {msgs.length === 1 ? 'message' : 'messages'}</p></div></div>
            {msgs.length ? (
              <div className="thread">
                {msgs.map((m, i) => (
                  <div key={i} className={`msg ${m.who}`}>
                    <div className="who2"><span>{m.who === 'agent' ? 'Agent' : f.name?.split(' ')[0] ?? 'Caller'}</span>{m.time && <span>{m.time}</span>}</div>
                    <div className="bubble">{m.text}</div>
                  </div>
                ))}
              </div>
            ) : <div className="empty"><b>No transcript</b>Vaani did not send one for this call.</div>}
          </section>

          <div className="stackcol">
            {!c.silent && (
              <section className="card" aria-labelledby="h-l">
                <div className="card-head"><h2 id="h-l" className="card-title">Lead</h2></div>
                <dl className="dl">
                  {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={v ? '' : 'dim'}>{v ?? 'Not given'}</dd></div>)}
                </dl>
              </section>
            )}

            {c.criteria && (
              <section className="card" aria-labelledby="h-q">
                <div className="card-head"><div><h2 id="h-q" className="card-title">Qualification</h2><p className="card-sub">Against the studio’s five criteria</p></div></div>
                <div className="checks">
                  {(Object.keys(CRITERIA) as CriterionKey[]).map((k) => {
                    const v = c.criteria![k];
                    return (
                      <div className="check" key={k}>
                        <span className={`tick ${v.status}`}><Icon name={TICK[v.status]} size={13} /></span>
                        <div><b>{CRITERIA[k]}</b><p>{v.note}</p></div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="card" aria-labelledby="h-d">
              <div className="card-head"><h2 id="h-d" className="card-title">Handoff</h2></div>
              <div className="timeline">
                <div className="step"><span className="node ok"><Icon name="phone" size={12} /></span><div><b>Call answered</b><span className="s">{when(c.created_at)}</span></div><span className="right">{dur(c.duration_sec)}</span></div>
                <div className="step"><span className={`node ${c.silent ? '' : 'ok'}`}><Icon name={c.silent ? 'flat' : 'check'} size={12} /></span><div><b>{c.silent ? 'Not triaged' : 'Triaged'}</b><span className="s">{c.silent ? 'Nobody spoke' : `By ${c.engine === 'gemini' ? 'Gemini' : 'rule-based fallback'}`}</span></div></div>
                <div className="step">
                  <span className={`node ${cons?.error ? 'bad' : cons?.start ? 'ok' : ''}`}><Icon name={cons?.error ? 'x' : 'clock'} size={12} /></span>
                  <div>
                    <b>Calendar hold</b>
                    <span className="s">
                      {cons?.error ? `Failed: ${cons.error}` : cons?.start ? `${describeSlot(new Date(cons.start))}, tentative${cons.calendar === 'mock' ? ' (mock)' : ''}` : cons?.skipped ?? (qualified ? 'Pending' : 'Not needed')}
                    </span>
                  </div>
                  {cons?.link && <a className="right link" href={cons.link} target="_blank" rel="noreferrer">Open</a>}
                </div>
                <div className="step">
                  <span className={`node ${tg?.error ? 'bad' : tg?.sent ? 'ok' : ''}`}><Icon name={tg?.error ? 'x' : 'send'} size={12} /></span>
                  <div><b>Telegram</b><span className="s">{tg?.error ? 'Failed. Retries on the next delivery.' : tg?.sent ? `Designer notified${tg.mock ? ' (mock)' : ''}` : c.silent ? 'Not sent' : 'Pending'}</span></div>
                </div>
                <div className="step">
                  <span className={`node ${hs?.error ? 'bad' : hs?.deal_id ? 'ok' : ''}`}><Icon name={hs?.error ? 'x' : 'briefcase'} size={12} /></span>
                  <div><b>HubSpot</b><span className="s">{hs?.error ? 'Failed. Retries on the next delivery.' : hs?.deal_id ? `Deal ${hs.deal_id}${hs.meeting_id ? ' · consultation logged' : ''}${hs.mock ? ' (mock)' : ''}` : qualified ? 'Pending' : 'No deal, not qualified'}</span></div>
                </div>
                <div className="step">
                  <span className={`node ${em?.error ? 'bad' : em?.sent ? 'ok' : ''}`}><Icon name={em?.error ? 'x' : 'message'} size={12} /></span>
                  <div><b>Customer email</b><span className="s">{em?.error ? `Failed: ${em.error}` : em?.sent ? `Sent to ${em.to}${em.mock ? ' (mock)' : ''}` : em?.skipped ?? (qualified ? 'Pending' : 'Not sent, not qualified')}</span></div>
                </div>
              </div>
              {tg?.sent && !c.silent && <div className="note-card">{note}</div>}
            </section>

            <section className="card" aria-labelledby="h-c">
              <div className="card-head"><h2 id="h-c" className="card-title">Cost</h2></div>
              <div className="dl" style={{ paddingTop: 10 }}>
                <div style={{ gridTemplateColumns: '1fr auto' }}><dt>Voice · {c.voice_minutes ?? 0} min</dt><dd>{inrExact(c.voice_cost_inr ?? 0)}</dd></div>
                <div style={{ gridTemplateColumns: '1fr auto' }}><dt>AI triage</dt><dd>{inrExact(c.ai_cost_inr ?? 0)}</dd></div>
                <div style={{ gridTemplateColumns: '1fr auto' }}><dt><b style={{ color: 'var(--ink)' }}>Total</b></dt><dd>{inrExact((c.voice_cost_inr ?? 0) + (c.ai_cost_inr ?? 0))}</dd></div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
