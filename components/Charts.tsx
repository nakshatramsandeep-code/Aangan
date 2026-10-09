import type { DayPoint } from '@/lib/metrics';
import type { Route } from '@/lib/types';

export const ROUTE_COLOR: Record<Route | 'silent', string> = {
  qualified: 'var(--c-qualified)',
  qualified_flag: 'var(--c-flag)',
  close_gracefully: 'var(--c-closed)',
  ask_question: 'var(--c-ask)',
  escalate: 'var(--c-escalate)',
  silent: 'var(--c-silent)',
};
// bottom to top
const STACK: Route[] = ['qualified', 'qualified_flag', 'close_gracefully', 'ask_question', 'escalate'];

/** Stacked daily bars. Pure CSS/HTML so it scales with the card and needs no chart library. */
export function DailyChart({ data, labels }: { data: DayPoint[]; labels: Record<Route, string> }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const niceMax = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const ticks = [niceMax, Math.round((niceMax * 2) / 3), Math.round(niceMax / 3), 0];
  const empty = data.every((d) => d.total === 0);
  const every = Math.ceil(data.length / 6);
  return (
    <div className="chart">
      <div className="chart-y" aria-hidden="true">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="chart-cols" role="img" aria-label={`Calls per day, ${data.length} days`}>
          {data.map((d) => (
            <div
              key={d.key}
              className="col"
              title={`${d.label}: ${d.total} ${d.total === 1 ? 'call' : 'calls'}${d.total ? ' (' + STACK.filter((r) => d.byRoute[r]).map((r) => `${d.byRoute[r]} ${labels[r].toLowerCase()}`).join(', ') + ')' : ''}`}
            >
              <div className="stack" style={{ height: `${(d.total / niceMax) * 100}%` }}>
                {STACK.map((r) => d.byRoute[r] > 0 && <i key={r} style={{ flex: d.byRoute[r], background: ROUTE_COLOR[r] }} />)}
              </div>
            </div>
          ))}
        </div>
        <div className="chart-x" aria-hidden="true">
          {data.map((d, i) => <span key={d.key} style={{ visibility: i % every === 0 || i === data.length - 1 ? 'visible' : 'hidden' }}>{d.label}</span>)}
        </div>
        {empty && <div className="chart-empty">No conversations in this period yet</div>}
      </div>
    </div>
  );
}

/** Tiny trend line for the stat cards. */
export function Sparkline({ values }: { values: number[] }) {
  const w = 96, h = 30, pad = 3;
  const max = Math.max(1, ...values);
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * w : w / 2);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" opacity="0.1" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
