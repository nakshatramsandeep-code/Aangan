import { logEvent } from '@/lib/db';
import { callEnded, callStarted } from '@/lib/pipeline';
import { authorised, normalizeCallStarted, normalizePostCall } from '@/lib/vaani';

export const maxDuration = 60;

/**
 * Vaani's webhook. Register it in Vaani: Settings -> Webhooks ->
 *   https://<your-domain>/api/vaani/webhook?secret=<VAANI_WEBHOOK_SECRET>
 * `call_started` remembers the caller's number (only that event carries it). `call_postprocessing`
 * (transcript + summary ready) starts the pipeline. Everything else is logged and acknowledged with a 200.
 */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const event = body?.event as string | undefined;
  const at = new Date().toISOString();
  if (!body) return Response.json({ status: 'ignored', reason: 'no json body' });

  if (event === 'call_started') {
    const n = normalizeCallStarted(body);
    await callStarted({ callId: n.callId, callerNumber: n.callerNumber, startedAt: n.startedAt }).catch(() => {});
    await logEvent({ at, event, ok: true, note: `noted caller ${n.callerNumber ?? '(no number)'}`, payload: body }).catch(() => {});
    return Response.json({ status: 'ok' });
  }

  if (event !== 'call_postprocessing') {
    await logEvent({ at, event, ok: true, note: 'logged only', payload: body }).catch(() => {});
    return Response.json({ status: 'ok' });
  }

  const n = normalizePostCall(body);
  try {
    const row = await callEnded({
      callId: n.callId,
      callerNumber: n.callerNumber,
      startedAt: n.startedAt,
      transcript: n.transcript,
      durationSec: n.durationSec,
    });
    await logEvent({ at, event, ok: true, note: `routed ${row.route}`, payload: body }).catch(() => {});
    return Response.json({ status: 'ok', id: row.id, route: row.route });
  } catch (e) {
    await logEvent({ at, event, ok: false, note: String((e as Error).message), payload: body }).catch(() => {});
    return Response.json({ status: 'error' }, { status: 500 });
  }
}
