import Link from 'next/link';
import { Shout } from '@/components/Header';
import { RoutePill, ROUTE_LABEL } from '@/components/RoutePill';
import { config, integrationStatus } from '@/lib/config';
import { listCalls } from '@/lib/db';
import { dur, inr, inrExact, when } from '@/lib/format';
import { computeMetrics } from '@/lib/metrics';
import type { Route } from '@/lib/types';

export const dynamic = 'force-dynamic';

const Kpi = ({ v, l, n }: { v: string | number; l: string; n?: string }) => (
  <div className="card kpi"><div className="l">{l}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>
);

const Glass = ({ v, l, n }: { v: string | number; l: string; n: string }) => (
  <div className="glass"><div className="l">{l}</div><div className="v">{v}</div><div className="n">{n}</div></div>
);

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ route?: string }> }) {
  const { route } = await searchParams;
  const calls = await listCalls();
  const m = computeMetrics(calls);
  const live = integrationStatus();
  const shown = calls.filter((c) => c.status === 'ended' && (!route || c.route === route)).slice(0, 100);
  const routes = Object.keys(ROUTE_LABEL) as Route[];
  const mock = Object.entries({ Neon: live.neon, Gemini: live.gemini, HubSpot: live.hubspot, Telegram: live.telegram }).filter(([, v]) => !v).map(([k]) => k);

  return (
    <>
      <Shout>
        <div className="hero big">
          <div className="rise">
            <p className="kicker">Last {m.days} days · {m.total} calls</p>
            <h1 className="mega">Every call answered.</h1>
            <p className="lede">
              {m.qualifiedN} of {m.total} reached a designer as a qualified lead, with everything already asked.
              {mock.length > 0 && <> Running on mock data for {mock.join(', ')}.</>}
            </p>
            <div className="hero-actions">
              <a href="#calls" className="btn dark">See every call</a>
              <Link href="/setup" className="btn outline">Setup</Link>
            </div>
          </div>
          <div className="blob rise d1">
            <div className="orb" /><div className="orb b" />
            <div className="glass-stack">
              <Glass v={`${m.answeredIn5Pct}%`} l="Answered within 5 minutes" n="Baseline: 52% answered within 48 hours" />
              <Glass v={`${m.qualifiedPct}%`} l="Qualified" n={`${m.qualifiedN} ${m.qualifiedN === 1 ? 'lead' : 'leads'} handed to designers`} />
              <Glass v={m.afterHours} l="After-hours calls" n={`${m.afterHoursPct}% of calls · ${m.afterHoursQualified} qualified`} />
            </div>
          </div>
        </div>
      </Shout>

      <div className="wrap">
        <h2>For Nikhil: is it working?</h2>
        <div className="grid">
          <Kpi v={m.handoffs} l="Handoff notes sent" n={`${m.handoffPct}% of calls`} />
          <Kpi v={m.byRoute.escalate} l="Complaints escalated" n="Straight to a human" />
          <Kpi v={`${Math.floor(m.avgDur / 60)}:${String(m.avgDur % 60).padStart(2, '0')}`} l="Average call length" n="Minutes : seconds" />
          <Kpi v={inrExact(m.cost.perCall)} l="Cost per call" n="Voice + AI + fixed" />
        </div>
        {(m.leaks > 0 || m.failedSteps > 0) && (
          <div className="card warn" style={{ marginTop: 14 }}>
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
            <div className="row"><span>Per qualified lead</span><span>{m.qualifiedN ? inrExact(m.cost.perQualified) : '-'}</span></div>
          </div>
          <div className="card">
            <b>What it is generating</b>
            <div className="row"><span>Qualified leads</span><span>{m.qualifiedN}</span></div>
            <div className="row"><span>Pipeline at ₹{config.projectValueLakh.low}-{config.projectValueLakh.high} L per project</span><span>{inr(m.pipeline.low)} to {inr(m.pipeline.high)}</span></div>
            <div className="row"><span>One ₹{config.projectValueLakh.low} L project covers this period's cost</span><span>{m.pipeline.oneProjectBreaksEven ? `${Math.round(m.pipeline.oneProjectBreaksEven)}×` : '-'}</span></div>
            <p className="dim" style={{ fontSize: 12, margin: '10px 0 0' }}>
              Pipeline is the value if every qualified lead converted. It is not revenue. Conversion comes from HubSpot once deals close. The voice rate is a placeholder until <code>VAANI_COST_PER_MIN_INR</code> is set.
            </p>
          </div>
        </div>

        <h2>Where calls went</h2>
        <div className="card">
          {routes.map((r) => (
            <div key={r} style={{ margin: '10px 0' }}>
              <div className="row" style={{ border: 0, padding: '0 0 6px' }}><span><RoutePill route={r} /></span><span>{m.byRoute[r]}</span></div>
              <div className="bar"><i style={{ width: `${m.total ? (m.byRoute[r] / m.total) * 100 : 0}%` }} /></div>
            </div>
          ))}
          <p className="dim" style={{ fontSize: 12, margin: '12px 0 0' }}>Every call that said anything is logged and sent to Telegram, closed ones included, so a designer can overturn a close.</p>
        </div>

        <h2 id="calls">For designers: every call</h2>
        <div className="filters">
          <Link href="/" className={!route ? 'on' : ''}>All</Link>
          {routes.map((r) => <Link key={r} href={`/?route=${r}`} className={route === r ? 'on' : ''}>{ROUTE_LABEL[r]}</Link>)}
        </div>
        <div className="panel">
          <div className="tablewrap">
            <table>
              <thead><tr><th>When</th><th>Caller</th><th>Route</th><th>Summary</th><th>Length</th><th></th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={6} className="dim">No calls yet. Call the studio number and the first one lands here.</td></tr>}
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td>{when(c.created_at)}{c.after_hours && <div className="dim" style={{ fontSize: 12 }}>after hours</div>}</td>
                    <td>{c.fields?.name ?? '-'}<div className="dim" style={{ fontSize: 12 }}>{c.caller_number}{c.simulated && ' · simulated'}</div></td>
                    <td><RoutePill route={c.route} />{c.price_leak && <span title="Agent may have quoted a price"> ⚠</span>}</td>
                    <td style={{ maxWidth: 380 }}>{c.summary}{c.flags.length > 0 && <div className="dim" style={{ fontSize: 12 }}>⚑ {c.flags[0]}</div>}</td>
                    <td>{dur(c.duration_sec)}</td>
                    <td><Link className="link" href={`/calls/${encodeURIComponent(c.id)}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
