import { book } from '@/lib/pipeline';
import { authorised, normalizeQualify } from '@/lib/vaani';

/** Vaani tool: book_consultation. Refuses unless the call already qualified. */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const n = normalizeQualify(body);
  if (!body.start) return Response.json({ ok: false, message: 'start (ISO time of a slot from get_slots) is required' }, { status: 400 });
  try {
    const r = await book(n.callId, { start: body.start, name: body.name, phone: body.phone ?? n.callerNumber, email: body.email });
    if (!r.ok) return Response.json({ ok: false, message: r.reason });
    return Response.json({ ok: true, confirmed_for: r.booking.start });
  } catch (e) {
    return Response.json({ ok: false, message: 'That slot could not be booked. Offer another slot.', detail: String((e as Error).message) });
  }
}
