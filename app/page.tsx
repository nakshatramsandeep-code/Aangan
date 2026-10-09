import Link from 'next/link';
import { RoutePill, ROUTE_LABEL } from '@/components/RoutePill';
import { Topbar } from '@/components/Topbar';
import { config, integrationStatus } from '@/lib/config';
import { listCalls } from '@/lib/db';
import { dur, inr, inrExact, when } from '@/lib/format';
import { computeMetrics } from '@/lib/metrics';
import type { Route } from '@/lib/types';

export const dynamic = 'force-dynamic';

const Stat = ({ l, v, n }: { l: string; v: string | number; n?: string }) => (
  <div className="stat"><div className="l">{l}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>
);

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ route?: string }> }) {
  const { route } = await searchParams;
  const calls = await listCalls();
  const m = computeMetrics(calls);
  const live = integrationStatus();
  const shown = calls.filter((c) => c.status === 'ended' && (!route || c.route === route)).slice(0, 100);
  const routes = Object.keys(ROUTE_LABEL) as Route[];
  const mock = Object.entries({ Neon: live.neon, Gemini: live.gemini, HubSpot: live.hubspot, Telegram: live.telegram })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return (
    <>
      <Topbar right={mock.length > 0 ? `Mock data: ${mock.join(', ')}` : undefined} />
      <div className="container">
        <div className="page-title">
          <div>
            <h1>Dashboard</h1>
            <p className="meta">Last {m.days} days</p>
          </div>
        </div>

        <div className="stats">
          <Stat l="Calls" v={m.total} n={`Average ${dur(m.avgDur)}`} />
          <Stat l="Answered within 5 min" v={`${m.answeredIn5Pct}%`} n="Before: 52% within 48 hours" />
          <Stat l="After-hours calls" v={m.afterHours} n={`${m.afterHoursPct}% of calls`} />
          <Stat l="Qualified" v={`${m.qualifiedPct}%`} n={`${m.qualifiedN} of ${m.total} calls`} />
          <Stat l="Cost per call" v={inrExact(m.cost.perCall)} n={`${inrExact(m.cost.total)} total`} />
        </div>

        {(m.leaks > 0 || m.failedSteps > 0) && (
          <div className="alert">
            {m.leaks > 0 && <div><b>{m.leaks}</b> call(s) where the agent may have quoted a price.</div>}
            {m.failedSteps > 0 && <div><b>{m.failedSteps}</b> call(s) where a Telegram or HubSpot step failed.</div>}
          </div>
        )}

        <h2>Cost and return</h2>
        <div className="two">
          <div className="card">
            <p className="card-title">Cost to run</p>
            <div className="row"><span>Voice ({inrExact(config.cost.vaaniPerMinInr)} per min)</span><span>{inrExact(m.cost.voice)}</span></div>
            <div className="row"><span>Gemini triage</span><span>{inrExact(m.cost.ai)}</span></div>
            <div className="row"><span>Fixed (hosting, database)</span><span>{inrExact(m.cost.fixed)}</span></div>
            <div className="row total"><span>Total</span><span>{inrExact(m.cost.total)}</span></div>
          </div>
          <div className="card">
            <p className="card-title">Generated</p>
            <div className="row"><span>Qualified leads</span><span>{m.qualifiedN}</span></div>
            <div className="row"><span>Cost per qualified lead</span><span>{m.qualifiedN ? inrExact(m.cost.perQualified) : '-'}</span></div>
            <div className="row total">
              <span>Pipeline at ₹{config.projectValueLakh.low}–{config.projectValueLakh.high} L per project</span>
              <span>{inr(m.pipeline.low)} – {inr(m.pipeline.high)}</span>
            </div>
            <p className="foot">Pipeline is potential value, not revenue. Closed deals are tracked in HubSpot.</p>
          </div>
        </div>

        <h2>Where calls went</h2>
        <div className="card bars">
          {routes.map((r) => (
            <div key={r}>
              <span><RoutePill route={r} /></span>
              <div className="bar"><i style={{ width: `${m.total ? (m.byRoute[r] / m.total) * 100 : 0}%` }} /></div>
              <span className="n">{m.byRoute[r]}</span>
            </div>
          ))}
        </div>

        <h2>Calls</h2>
        <div className="tabs">
          <Link href="/" className={!route ? 'on' : ''}>All</Link>
          {routes.map((r) => <Link key={r} href={`/?route=${r}`} className={route === r ? 'on' : ''}>{ROUTE_LABEL[r]}</Link>)}
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>Caller</th><th>Route</th><th>Summary</th><th>Length</th><th></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={6} className="dim">No calls yet.</td></tr>}
              {shown.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(c.created_at)}{c.after_hours && <div className="small">After hours</div>}</td>
                  <td>{c.fields?.name ?? '-'}<div className="small">{c.caller_number}</div></td>
                  <td><RoutePill route={c.route} />{c.price_leak && <div className="small bad">Possible price quoted</div>}</td>
                  <td style={{ maxWidth: 420 }}>{c.summary}{c.flags.length > 0 && <div className="small">Flag: {c.flags[0]}</div>}</td>
                  <td>{dur(c.duration_sec)}</td>
                  <td><Link className="link" href={`/calls/${encodeURIComponent(c.id)}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
