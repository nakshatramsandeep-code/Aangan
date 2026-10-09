import { config } from './config';
import type { CallRow, Route } from './types';

const DAY = 864e5;

export function computeMetrics(all: CallRow[], days = 30) {
  const since = Date.now() - days * DAY;
  const calls = all.filter((c) => c.status === 'ended' && new Date(c.created_at).getTime() >= since);
  const total = calls.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const byRoute: Record<Route, number> = { qualified: 0, qualified_flag: 0, ask_question: 0, close_gracefully: 0, escalate: 0 };
  for (const c of calls) if (c.route) byRoute[c.route]++;

  const answeredIn5 = calls.filter((c) => (c.answered_in_sec ?? 0) <= 300).length;
  const afterHours = calls.filter((c) => c.after_hours);
  const qualifiedN = byRoute.qualified + byRoute.qualified_flag;
  const bookings = calls.filter((c) => c.booking).length;
  const handoffs = calls.filter((c) => c.alert?.sent).length;
  const leaks = calls.filter((c) => c.price_leak?.length).length;
  const failedSteps = calls.filter((c) => c.alert?.error || c.hubspot?.error).length;

  const voice = calls.reduce((s, c) => s + (c.voice_cost_inr ?? 0), 0);
  const ai = calls.reduce((s, c) => s + (c.ai_cost_inr ?? 0), 0);
  const fixed = config.cost.fixedMonthlyInr * (days / 30);
  const totalCost = voice + ai + fixed;

  const avgDur = total ? Math.round(calls.reduce((s, c) => s + (c.duration_sec ?? 0), 0) / total) : 0;
  const lakh = (n: number) => n * 1e5;

  return {
    days,
    total,
    answeredIn5Pct: pct(answeredIn5),
    afterHours: afterHours.length,
    afterHoursPct: pct(afterHours.length),
    afterHoursQualified: afterHours.filter((c) => c.route === 'qualified' || c.route === 'qualified_flag').length,
    qualifiedN,
    qualifiedPct: pct(qualifiedN),
    byRoute,
    bookings,
    handoffs,
    handoffPct: pct(handoffs),
    leaks,
    failedSteps,
    avgDur,
    cost: {
      voice, ai, fixed, total: totalCost,
      perCall: total ? totalCost / total : 0,
      perBooking: bookings ? totalCost / bookings : 0,
    },
    pipeline: {
      low: lakh(config.projectValueLakh.low) * qualifiedN,
      high: lakh(config.projectValueLakh.high) * qualifiedN,
      oneProjectBreaksEven: totalCost > 0 ? lakh(config.projectValueLakh.low) / totalCost : 0,
    },
  };
}
