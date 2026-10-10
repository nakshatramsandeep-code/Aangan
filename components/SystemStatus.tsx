import { Icon } from './Icons';
import { listEvents } from '@/lib/db';
import { overall, runChecks, type Check } from '@/lib/health';
import type { CallRow } from '@/lib/types';

const LABEL = { ok: 'Working', warn: 'Needs attention', down: 'Broken', off: 'Not connected' } as const;

/** Streams in after the rest of the page, because it makes live calls to every provider. */
export async function SystemStatus({ calls, fresh = false }: { calls: CallRow[]; fresh?: boolean }) {
  const events = await listEvents(10);
  const checks = await runChecks(calls, events, fresh);
  const all = overall(checks);
  const bad = checks.filter((c) => c.status === 'down' || c.status === 'warn');
  const headline = bad.length === 0 ? 'Every stage is working' : `${bad.length} ${bad.length === 1 ? 'stage needs' : 'stages need'} attention`;
  // The first broken stage is where a call stops flowing; everything after it is downstream of the fault.
  const firstDown = checks.findIndex((c) => c.status === 'down');

  return (
    <section className="card section-card" id="status" aria-labelledby="h-status">
      <div className="card-head">
        <div>
          <h2 id="h-status" className="card-title">Pipeline status</h2>
          <p className="card-sub">{headline}. Checked live just now.</p>
        </div>
        <div className="head-actions">
          <span className={`overall ${all}`}><i />{all === 'ok' ? 'All systems operational' : all === 'warn' ? 'Degraded' : 'Outage'}</span>
          <a className="btn secondary" href={`/status?fresh=${Date.now()}`}>Check again</a>
        </div>
      </div>
      <ol className="pipe">
        {checks.map((c: Check, i) => (
          <li key={c.id} className={`pnode ${c.status}${firstDown >= 0 && i > firstDown ? ' after' : ''}`}>
            <div className="pnode-top">
              <span className="pdot" aria-hidden="true" />
              <span className="pstate">{LABEL[c.status]}</span>
              {c.ms !== undefined && <span className="pms">{c.ms} ms</span>}
            </div>
            <b>{c.name}</b>
            <span className="prole">{c.role}</span>
            <p className="pdetail">{c.detail}</p>
            {i < checks.length - 1 && <span className="parrow" aria-hidden="true"><Icon name="up" size={14} /></span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SystemStatusSkeleton() {
  return (
    <section className="card section-card" aria-busy="true" aria-label="Checking pipeline status">
      <div className="card-head"><div><h2 className="card-title">Pipeline status</h2><p className="card-sub">Checking every stage…</p></div></div>
      <ol className="pipe">{Array.from({ length: 8 }).map((_, i) => <li key={i} className="pnode skel"><span className="pdot" /><b>&nbsp;</b><span className="prole">&nbsp;</span><p className="pdetail">&nbsp;</p></li>)}</ol>
    </section>
  );
}
