import { config } from './config';
import type { CallRow, Route } from './types';

const DAY = 864e5;
export const ROUTES: Route[] = ['qualified', 'qualified_flag', 'ask_question', 'close_gracefully', 'escalate'];

const isQualified = (c: CallRow) => c.route === 'qualified' || c.route === 'qualified_flag';

/** IST calendar day, e.g. "2026-10-09". */
const dayKey = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));

function summarise(all: CallRow[], from: number, to: number, days: number) {
  const ended = all.filter((c) => {
    const t = new Date(c.created_at).getTime();
    return c.status === 'ended' && t >= from && t < to;
  });
  // Rates are over conversations. Silent calls (nobody spoke) still count towards cost.
  const calls = ended.filter((c) => !c.silent);
  const silent = ended.length - calls.length;
  const total = calls.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const byRoute: Record<Route, number> = { qualified: 0, qualified_flag: 0, ask_question: 0, close_gracefully: 0, escalate: 0 };
  for (const c of calls) if (c.route) byRoute[c.route]++;

  const afterHours = calls.filter((c) => c.after_hours);
  const qualifiedN = byRoute.qualified + byRoute.qualified_flag;
  const handoffs = calls.filter((c) => c.alert?.sent).length;
  const leaks = calls.filter((c) => c.price_leak?.length).length;
  const failedSteps = calls.filter((c) => c.alert?.error || c.hubspot?.error).length;

  const voice = ended.reduce((s, c) => s + (c.voice_cost_inr ?? 0), 0);
  const ai = ended.reduce((s, c) => s + (c.ai_cost_inr ?? 0), 0);
  const fixed = config.cost.fixedMonthlyInr * (days / 30);
  const totalCost = voice + ai + fixed;
  const avgDur = total ? Math.round(calls.reduce((s, c) => s + (c.duration_sec ?? 0), 0) / total) : 0;
  const lakh = (n: number) => n * 1e5;

  return {
    total,
    silent,
    afterHours: afterHours.length,
    afterHoursPct: pct(afterHours.length),
    afterHoursQualified: afterHours.filter(isQualified).length,
    qualifiedN,
    qualifiedPct: pct(qualifiedN),
    byRoute,
    handoffs,
    leaks,
    failedSteps,
    avgDur,
    cost: {
      voice, ai, fixed, total: totalCost,
      perCall: ended.length ? totalCost / ended.length : 0,
      perQualified: qualifiedN ? totalCost / qualifiedN : 0,
    },
    pipeline: {
      low: lakh(config.projectValueLakh.low) * qualifiedN,
      high: lakh(config.projectValueLakh.high) * qualifiedN,
    },
  };
}

export type DayPoint = { key: string; label: string; total: number; qualified: number; afterHours: number; byRoute: Record<Route, number> };

function dailySeries(all: CallRow[], days: number): DayPoint[] {
  const out = new Map<string, DayPoint>();
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    out.set(dayKey(d), {
      key: dayKey(d),
      label: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }),
      total: 0, qualified: 0, afterHours: 0,
      byRoute: { qualified: 0, qualified_flag: 0, ask_question: 0, close_gracefully: 0, escalate: 0 },
    });
  }
  for (const c of all) {
    if (c.status !== 'ended' || c.silent || !c.route) continue;
    const p = out.get(dayKey(c.created_at));
    if (!p) continue;
    p.total++; p.byRoute[c.route]++;
    if (isQualified(c)) p.qualified++;
    if (c.after_hours) p.afterHours++;
  }
  return [...out.values()];
}

export function computeMetrics(all: CallRow[], days = 30) {
  const now = Date.now();
  const cur = summarise(all, now - days * DAY, now + 1, days);
  const prev = summarise(all, now - 2 * days * DAY, now - days * DAY, days);
  // Calls that started but never produced a transcript: a webhook that never arrived, or a call still running.
  const stuck = all.filter((c) => c.status === 'in_progress' && now - new Date(c.created_at).getTime() > 15 * 60e3 && new Date(c.created_at).getTime() >= now - days * DAY).length;
  return { days, ...cur, prev, stuck, daily: dailySeries(all, days) };
}
