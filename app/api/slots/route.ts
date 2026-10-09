import { slotsFor } from '@/lib/pipeline';
import { authorised, normalizeQualify } from '@/lib/vaani';

/** Vaani tool: get_slots. Only qualified calls get slots. */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const n = normalizeQualify(await req.json().catch(() => ({})));
  const r = await slotsFor(n.callId);
  if (!r.allowed) return Response.json({ slots: [], message: r.reason });
  const spoken = r.slots.map((s) =>
    new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }),
  );
  return Response.json({ slots: r.slots.map((iso, i) => ({ start: iso, spoken: spoken[i] })) });
}
