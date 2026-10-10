import { listCalls, listEvents } from '@/lib/db';
import { overall, runChecks } from '@/lib/health';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/** Machine-readable status of every stage, for the dashboard and the end-to-end test. Contains no secrets. */
export async function GET() {
  const [calls, events] = await Promise.all([listCalls(50), listEvents(10)]);
  const checks = await runChecks(calls, events);
  return Response.json({ status: overall(checks), at: new Date().toISOString(), checks });
}
