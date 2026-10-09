import Link from 'next/link';
import { RoutePill, ROUTE_LABEL } from '@/components/RoutePill';
import { listCalls } from '@/lib/db';
import { config, integrationStatus } from '@/lib/config';
import { dur, inr, inrExact, when } from '@/lib/format';
import { computeMetrics } from '@/lib/metrics';
import type { Route } from '@/lib/types';

export const dynamic = 'force-dynamic';

const Kpi = ({ v, l, n }: { v: string | number; l: string; n?: string }) => (
  <div className="card kpi"><div className="v">{v}</div><div className="l">{l}</div>{n && <div className="n">{n}</div>}</div>
);

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ route?: string }> }) {
  const { route } = await searchParams;
  const calls = await listCalls();
  const m = computeMetrics(calls);
  const live = integrationStatus();
  const shown = calls.filter((c) => c.status === 'ended' && (!route || c.route === route)).slice(0, 100);
  const routes = Object.keys(ROUTE_LABEL) as Route[];
  const mock = Object.entries({ Neon: live.neon, Gemini: live.gemini, 'Cal.com': live.calcom, HubSpot: live.hubspot, Telegram: live.telegram }).filter(([, v]) => !v).map(([k]) => k);

  return (
    <>
      <h1>Last {m.days} days</h1>
      <p className="sub">
        {m.total} calls answered.{' '}
        {mock.length > 0 && <>Not connected yet, running on mock data: <b>{mock.join(', ')}</b>. <Link href="/setup">Setup</Link></>}
      </p>

      <h2 style={{ marginTop: 0 }}>For Nikhil: is it working?</h2>
      <div className="grid">
        <Kpi v={`${m.answeredIn5Pct}%`} l="Answered within 5 minutes" n="Baseline: 52% answered within 48 hours" />
        <Kpi v={m.afterHours} l="After-hours calls" n={`${m.afterHoursPct}% of calls · ${m.afterHoursQualified} qualified`} />
        <Kpi v={`${m.qualifiedPct}%`} l="Qualified" n={`${m.qualifiedN} of ${m.total} reached a designer as a lead`} />
        <Kpi v={m.bookings} l="Consultations booked" n="Booked inside the call" />
        <Kpi v={`${m.handoffPct}%`} l="Handoff notes sent" n={`${m.handoffs} designer alerts`} />
        <Kpi v={m.byRoute.escalate} l="Complaints escalated" n="Straight to a human" />
      </div>
      {(m.leaks > 0 || m.failedSteps > 0) && (
        <div className="card warn" style={{ marginTop: 12 }}>
          {m.leaks > 0 && <div><b className="bad">{m.leaks} call(s)</b> where the agent may have said a price. Open them below (marked ⚠).</div>}
          {m.failedSteps > 0 && <div><b className="bad">{m.failedSteps} call(s)</b> where Telegram or HubSpot failed. Open them below.</div>}
        </div>
      )}

      <h2>What it costs vs what it generates</h2>
      <div className="two">
        <div className="card">
          <b>Cost to run</b>
          <div className="row"><span>Voice ({inrExact(config.cost.vaaniPerMinInr)}/min)</span><span>{inrExact(m.cost.voice)}</span></div>
          <div className="row"><span>Gemini triage</span><span>{inrExact(m.cost.ai)}</span></div>
          <div className="row"><span>Fixed (Vercel, Neon, etc.)</span><span>{inrExact(m.cost.fixed)}</span></div>
          <div className="row"><b>Total</b><b>{inrExact(m.cost.total)}</b></div>
          <div className="row"><span>Per call</span><span>{inrExact(m.cost.perCall)}</span></div>
          <div className="row"><span>Per booked consultation</span><span>{m.bookings ? inrExact(m.cost.perBooking) : '-'}</span></div>
        </div>
        <div className="card">
          <b>What it is generating</b>
          <div className="row"><span>Qualified leads</span><span>{m.qualifiedN}</span></div>
          <div className="row"><span>Pipeline at ₹{config.projectValueLakh.low}-{config.projectValueLakh.high} L per project</span><span>{inr(m.pipeline.low)} to {inr(m.pipeline.high)}</span></div>
          <div className="row"><span>One project of ₹{config.projectValueLakh.low} L covers this period's cost</span><span>{m.pipeline.oneProjectBreaksEven ? `${Math.round(m.pipeline.oneProjectBreaksEven)}×` : '-'}</span></div>
          <p className="dim" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Pipeline is the value if every qualified lead converted. It is not revenue. Conversion comes from HubSpot once deals close. Voice rate is a placeholder until set in <code>VAANI_COST_PER_MIN_INR</code>.
          </p>
        </div>
      </div>

      <h2>Where calls went</h2>
      <div className="card">
        {routes.map((r) => (
          <div key={r} style={{ margin: '6px 0' }}>
            <div className="row" style={{ border: 0, padding: 0 }}><span><RoutePill route={r} /></span><span>{m.byRoute[r]}</span></div>
            <div className="bar"><i style={{ width: `${m.total ? (m.byRoute[r] / m.total) * 100 : 0}%` }} /></div>
          </div>
        ))}
        <p className="dim" style={{ fontSize: 12, margin: '8px 0 0' }}>Every call that said anything is logged and sent to Telegram, closed ones included, so a designer can overturn a close.</p>
      </div>

      <h2>For designers: every call</h2>
      <div className="filters">
        <Link href="/" className={!route ? 'on' : ''}>All</Link>
        {routes.map((r) => <Link key={r} href={`/?route=${r}`} className={route === r ? 'on' : ''}>{ROUTE_LABEL[r]}</Link>)}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>When</th><th>Caller</th><th>Route</th><th>Summary</th><th>Booked</th><th>Length</th><th></th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="dim">No calls yet. Try <Link href="/simulate">Simulate a call</Link>.</td></tr>}
            {shown.map((c) => (
              <tr key={c.id}>
                <td>{when(c.created_at)}{c.after_hours && <div className="dim" style={{ fontSize: 12 }}>after hours</div>}</td>
                <td>{c.fields?.name ?? '-'}<div className="dim" style={{ fontSize: 12 }}>{c.caller_number}{c.simulated && ' · simulated'}</div></td>
                <td><RoutePill route={c.route} />{c.price_leak && <span title="Agent may have quoted a price"> ⚠</span>}</td>
                <td style={{ maxWidth: 380 }}>{c.summary}{c.flags.length > 0 && <div className="dim" style={{ fontSize: 12 }}>⚑ {c.flags[0]}</div>}</td>
                <td>{c.booking ? new Date(c.booking.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-'}</td>
                <td>{dur(c.duration_sec)}</td>
                <td><Link href={`/calls/${encodeURIComponent(c.id)}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
