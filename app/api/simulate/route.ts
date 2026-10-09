import { deleteSimulated } from '@/lib/db';
import { callEnded } from '@/lib/pipeline';

export const maxDuration = 60;

/** Dashboard-only: push a transcript through the exact call-ended pipeline, without a phone call. */
export async function POST(req: Request) {
  const { transcript, durationSec, callerNumber, startedAt } = await req.json();
  if (!transcript || typeof transcript !== 'string') return Response.json({ error: 'transcript required' }, { status: 400 });
  const row = await callEnded({
    callId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    callerNumber: callerNumber || '+910000000000',
    startedAt,
    transcript,
    durationSec: Number(durationSec) || 180,
    answeredInSec: 3,
    simulated: true,
  });
  return Response.json({ id: row.id, route: row.route });
}

export async function DELETE() {
  return Response.json({ removed: await deleteSimulated() });
}
