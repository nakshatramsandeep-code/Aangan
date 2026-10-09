import type { Route } from '@/lib/types';

export const ROUTE_LABEL: Record<Route, string> = {
  qualified: 'Qualified',
  qualified_flag: 'Qualified, flagged',
  ask_question: 'Incomplete',
  close_gracefully: 'Closed kindly',
  escalate: 'Escalated',
};

export function RoutePill({ route, silent }: { route?: Route; silent?: boolean }) {
  if (silent) return <span className="pill silent"><i />No conversation</span>;
  if (!route) return <span className="pill silent"><i />In progress</span>;
  return <span className={`pill ${route}`}><i />{ROUTE_LABEL[route]}</span>;
}
