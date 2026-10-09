import { qualify } from '@/lib/pipeline';
import { authorised, normalizeQualify } from '@/lib/vaani';

export const maxDuration = 30;

/** Called by Vaani mid-call. Returns the route (and the next question or what to say). */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const n = normalizeQualify(await req.json().catch(() => ({})));
  const result = await qualify({
    callId: n.callId,
    callerNumber: n.callerNumber,
    startedAt: n.startedAt,
    answers: n.answers,
    transcript: n.transcript,
  });
  return Response.json({ route: result.route, say: result.say, next_question: result.next_question ?? null });
}
