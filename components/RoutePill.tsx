import type { Route } from '@/lib/types';

export const ROUTE_LABEL: Record<Route, string> = {
  qualified: 'Qualified',
  qualified_flag: 'Qualified + flag',
  ask_question: 'Incomplete',
  close_gracefully: 'Closed gracefully',
  escalate: 'Escalated',
};

export function RoutePill({ route }: { route?: Route }) {
  if (!route) return <span className="dim">-</span>;
  return <span className={`pill ${route}`}>{ROUTE_LABEL[route]}</span>;
}
