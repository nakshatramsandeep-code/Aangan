import Link from 'next/link';
import { DailyChart, ROUTE_COLOR, Sparkline } from '@/components/Charts';
import { Icon, type IconName } from '@/components/Icons';
import { ROUTE_LABEL, RoutePill } from '@/components/RoutePill';
import { Topbar } from '@/components/Topbar';
import { config, integrationStatus } from '@/lib/config';
import { listCalls } from '@/lib/db';
import { ago, delta, dur, initials, inr, inrExact, phone } from '@/lib/format';
import { computeMetrics, ROUTES } from '@/lib/metrics';
import type { CallRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { days?: string; f?: string; q?: string; n?: string };
const PERIODS = [7, 30, 90];
const PAGE = 25;

const href = (p: Params) => {
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return qs ? `/?${qs}` : '/';
};

function Delta({ d }: { d: ReturnType<typeof delta> }) {
  if (!d) return null;
  return <span className={`delta ${d.dir}`}><Icon name={d.dir === 'flat' ? 'flat' : d.dir} size={11} />{d.text}</span>;
}

function Stat({ icon, label, value, note, trend, d }: { icon: IconName; label: string; value: string | number; note: string; trend?: number[]; d?: ReturnType<typeof delta> }) {
  return (
    <div className="card stat">
      <div className="stat-l"><span className="ico"><Icon name={icon} size={15} /></span>{label}</div>
      <div className="stat-row">
        <div>
          <div className="stat-v">{value}{d && <Delta d={d} />}</div>
          <div className="stat-n">{note}</div>
        </div>
        {trend && <Sparkline values={trend} />}
      </div>
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const f = sp.f ?? '';
  const q = (sp.q ?? '').trim();
  const limit = Math.max(PAGE, Number(sp.n) || PAGE);

  const all = await listCalls();
  const m = computeMetrics(all, days);
  const live = integrationStatus();
  const mock = Object.entries({ Neon: live.neon, Gemini: live.gemini, HubSpot: live.hubspot, Telegram: live.telegram }).filter(([, v]) => !v).map(([k]) => k);

  const since = Date.now() - days * 864e5;
  const inPeriod = all.filter((c) => c.status === 'ended' && new Date(c.created_at).getTime() >= since);
  const matchF = (c: CallRow) =>
    !f ? !c.silent
    : f === 'silent' ? !!c.silent
    : f === 'price' ? !!c.price_leak?.length
    : f === 'failed' ? !!(c.alert?.error || c.hubspot?.error)
    : c.route === f && !c.silent;
  const needle = q.toLowerCase();
  const matchQ = (c: CallRow) =>
    !needle || [c.fields?.name, c.caller_number, c.summary, c.fields?.locality, c.fields?.scope].some((v) => v?.toLowerCase().includes(needle));
  const rows = inPeriod.filter((c) => matchF(c) && matchQ(c));
  const shown = rows.slice(0, limit);
  const count = (fn: (c: CallRow) => boolean) => inPeriod.filter(fn).length;

  const tabs: { key: string; label: string; n: number }[] = [
    { key: '', label: 'All', n: count((c) => !c.silent) },
    ...ROUTES.map((r) => ({ key: r, label: ROUTE_LABEL[r], n: count((c) => c.route === r && !c.silent) })),
    ...(m.silent ? [{ key: 'silent', label: 'No conversation', n: m.silent }] : []),
  ];

  const qualDelta = m.prev.total ? m.qualifiedPct - m.prev.qualifiedPct : null;
  const periodLabel = `last ${days} days`;

  return (
    <>
      <Topbar>
        <nav className="seg" aria-label="Period">
          {PERIODS.map((p) => <Link key={p} href={href({ days: p === 30 ? '' : String(p) })} className={p === days ? 'on' : ''}>{p}d</Link>)}
        </nav>
        <span className={`status ${mock.length ? 'mock' : ''}`} title={mock.length ? `Not connected: ${mock.join(', ')}` : 'All integrations connected'}>
          <i />{mock.length ? 'Mock data' : 'Live'}
        </span>
      </Topbar>

      <main className="container">
        <div className="page-title">
          <div>
            <h1>Phone desk</h1>
            <p className="meta">Every enquiry call, from the first ring to the designer’s handoff · {periodLabel}</p>
          </div>
        </div>

        <div className="stats">
          <Stat icon="phone" label="Conversations" value={m.total} d={delta(m.total, m.prev.total)}
            note={m.silent ? `${m.silent} silent ${m.silent === 1 ? 'call' : 'calls'} excluded` : `Average ${dur(m.avgDur)}`}
            trend={m.daily.map((d) => d.total)} />
          <Stat icon="check" label="Qualified" value={`${m.qualifiedPct}%`}
            d={qualDelta === null ? null : { text: `${qualDelta > 0 ? '+' : ''}${qualDelta} pts`, dir: qualDelta > 0 ? 'up' : qualDelta < 0 ? 'down' : 'flat' }}
            note={`${m.qualifiedN} of ${m.total} reached a designer`} trend={m.daily.map((d) => d.qualified)} />
          <Stat icon="moon" label="After hours" value={m.afterHours}
            d={delta(m.afterHours, m.prev.afterHours)}
            note={`${m.afterHoursPct}% of calls · ${m.afterHoursQualified} qualified`} trend={m.daily.map((d) => d.afterHours)} />
          <Stat icon="rupee" label="Cost per call" value={inrExact(m.cost.perCall)} note={`${inrExact(m.cost.total)} in ${days} days`} />
        </div>

        {m.total > 0 && (
          <div className="insight">
            <span className="ico"><Icon name="zap" size={18} /></span>
            <span>
              Every call was picked up by the agent, so none waited for the front desk{m.afterHours > 0 && <>, including <b>{m.afterHours}</b> outside office hours</>}.
              Before this, about half of all enquiries got no reply within 48 hours.
            </span>
          </div>
        )}

        {(m.leaks > 0 || m.failedSteps > 0 || m.stuck > 0) && (
          <div className="alerts">
            {m.leaks > 0 && <Link className="chip-alert" href={href({ days: sp.days, f: 'price' })}><Icon name="alert" size={15} />{m.leaks} {m.leaks === 1 ? 'call' : 'calls'} where a price may have been quoted</Link>}
            {m.failedSteps > 0 && <Link className="chip-alert" href={href({ days: sp.days, f: 'failed' })}><Icon name="alert" size={15} />{m.failedSteps} {m.failedSteps === 1 ? 'call' : 'calls'} with a failed Telegram or HubSpot step</Link>}
            {m.stuck > 0 && <span className="chip-alert warn"><Icon name="clock" size={15} />{m.stuck} {m.stuck === 1 ? 'call' : 'calls'} started but never completed</span>}
          </div>
        )}

        <div className="split">
          <section className="card" aria-labelledby="h-chart">
            <div className="card-head">
              <div><h2 id="h-chart" className="card-title">Calls per day</h2><p className="card-sub">Conversations by outcome</p></div>
            </div>
            <div className="legend">{ROUTES.map((r) => <span key={r}><i style={{ background: ROUTE_COLOR[r] }} />{ROUTE_LABEL[r]}</span>)}</div>
            <DailyChart data={m.daily} labels={ROUTE_LABEL} />
          </section>

          <section className="card" aria-labelledby="h-out">
            <div className="card-head"><div><h2 id="h-out" className="card-title">Outcomes</h2><p className="card-sub">Where {m.total} {m.total === 1 ? 'call' : 'calls'} went</p></div></div>
            <div className="outcomes">
              {ROUTES.map((r) => (
                <Link key={r} href={href({ days: sp.days, f: r })} className="outcome">
                  <span className="lbl"><span className="dot" style={{ background: ROUTE_COLOR[r] }} />{ROUTE_LABEL[r]}</span>
                  <span className="num">{m.byRoute[r]}<small>{m.total ? Math.round((m.byRoute[r] / m.total) * 100) : 0}%</small></span>
                  <span className="bar"><i style={{ width: `${m.total ? (m.byRoute[r] / m.total) * 100 : 0}%`, background: ROUTE_COLOR[r] }} /></span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <section className="section" aria-labelledby="h-roi">
          <div className="card">
            <div className="card-head"><div><h2 id="h-roi" className="card-title">Cost and return</h2><p className="card-sub">What the phone desk costs to run, and what it hands to the studio</p></div></div>
            <div className="ledger" style={{ marginTop: 10 }}>
              <div>
                <h3>Cost to run</h3>
                <div className="big">{inrExact(m.cost.total)}</div>
                <div className="row"><span>Voice · {inrExact(config.cost.vaaniPerMinInr)} per minute</span><span>{inrExact(m.cost.voice)}</span></div>
                <div className="row"><span>Gemini triage</span><span>{inrExact(m.cost.ai)}</span></div>
                <div className="row"><span>Hosting and database</span><span>{inrExact(m.cost.fixed)}</span></div>
              </div>
              <div>
                <h3>Qualified leads</h3>
                <div className="big">{m.qualifiedN}</div>
                <div className="row"><span>Cost per qualified lead</span><span>{m.qualifiedN ? inrExact(m.cost.perQualified) : '–'}</span></div>
                <div className="row"><span>Handoff notes sent</span><span>{m.handoffs}</span></div>
              </div>
              <div>
                <h3>Pipeline potential</h3>
                <div className="big">{m.qualifiedN ? `${inr(m.pipeline.low)} – ${inr(m.pipeline.high)}` : '–'}</div>
                <div className="row"><span>Project value assumed</span><span>₹{config.projectValueLakh.low}–{config.projectValueLakh.high} L</span></div>
                <p className="foot">Potential value if every qualified lead became a project. It is not revenue; closed deals live in HubSpot.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="calls" aria-labelledby="h-calls">
          <div className="page-title" style={{ marginBottom: 12 }}><h2 id="h-calls" style={{ fontSize: 17 }}>Calls</h2></div>
          <div className="card">
            <div className="toolbar">
              <nav className="tabs" aria-label="Filter by outcome">
                {tabs.map((t) => <Link key={t.key} href={href({ days: sp.days, f: t.key, q })} className={f === t.key ? 'on' : ''}>{t.label}<b>{t.n}</b></Link>)}
              </nav>
              <form className="search" action="/" role="search">
                {sp.days && <input type="hidden" name="days" value={sp.days} />}
                {f && <input type="hidden" name="f" value={f} />}
                <span className="ico"><Icon name="search" size={15} /></span>
                <input type="search" name="q" defaultValue={q} placeholder="Search name, number, area…" aria-label="Search calls" />
              </form>
            </div>

            {shown.length === 0 ? (
              <div className="empty">
                <b>{q || f ? 'No calls match' : 'No calls yet'}</b>
                {q || f ? <Link className="link" href={href({ days: sp.days })}>Clear filters</Link> : 'The first call will appear here as soon as the agent finishes it.'}
              </div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Caller</th><th>Outcome</th><th>Summary</th><th>When</th><th>Length</th></tr></thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className="who">
                            <span className={`avatar ${c.fields?.name ? '' : 'none'}`}>{c.fields?.name ? initials(c.fields.name) : <Icon name="user" size={16} />}</span>
                            <div>
                              <b><Link href={`/calls/${encodeURIComponent(c.id)}`}>{c.fields?.name ?? 'Unknown caller'}</Link></b>
                              <span className="small">{phone(c.caller_number) || 'No number'}</span>
                            </div>
                          </div>
                        </td>
                        <td data-l="Outcome"><RoutePill route={c.route} silent={c.silent} /></td>
                        <td data-l="Summary">
                          <div className="sum">{c.summary}</div>
                          {c.price_leak && <div className="flagline bad"><Icon name="alert" size={13} />Possible price quoted</div>}
                          {!c.price_leak && c.flags[0] && <div className="flagline"><Icon name="flag" size={13} />{c.flags[0]}</div>}
                        </td>
                        <td className="when" data-l="When">{c.after_hours && <span className="ico" title="After hours"><Icon name="moon" size={14} /></span>}{ago(c.created_at)}</td>
                        <td className="len" data-l="Length">{dur(c.duration_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > shown.length && <Link className="more" href={href({ days: sp.days, f, q, n: String(limit + PAGE) })}>Show {Math.min(PAGE, rows.length - shown.length)} more of {rows.length - shown.length}</Link>}
          </div>
        </section>
      </main>
    </>
  );
}
