import { callEnded } from '@/lib/pipeline';
import { authorised, normalizeCallEnded } from '@/lib/vaani';

export const maxDuration = 60;

/** Called by Vaani when the call ends: logs the row, then fans out to Telegram and HubSpot. */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const n = normalizeCallEnded(await req.json().catch(() => ({})));
  const row = await callEnded(n);
  return Response.json({ ok: true, id: row.id, route: row.route, alert: row.alert?.sent ?? false, hubspot: row.hubspot?.deal_id ?? null });
}
