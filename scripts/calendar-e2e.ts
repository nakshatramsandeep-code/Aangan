/**
 * End-to-end test of the calendar path against production, using the REAL Google Calendar.
 *
 *   npm run e2e:calendar
 *
 * Callers use numbers that are NOT on the reserved test list (+91 99999 00xxx), so the app creates genuine
 * tentative events on the connected calendar. Each is checked against Google's own API. The run covers:
 *   A  caller asks for a free weekday+time        -> the hold is exactly that time; a real email is sent to OWNER_EMAIL
 *   B  a second caller asks for the SAME time      -> no double-booking: gets the next free slot
 *   C  a caller asks for a Saturday                -> moved to a working day inside office hours
 *   D  a caller names no time                      -> next free slot, at least 18 h ahead
 *   E  a caller outside Pune                       -> no hold, no email, no meeting
 * Afterwards every test event is deleted from the calendar and the test calls are removed from the log.
 * Side effects that stay: Telegram notes, and HubSpot deals + meetings for A-D (delete them in HubSpot).
 */
import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
}

const BASE = (process.argv[2] || 'https://aangan-gamma.vercel.app').replace(/\/$/, '');
const OWNER_EMAIL = 'nakshatram_sandeep@pg27.mesaschool.co';
const SECRET = process.env.VAANI_WEBHOOK_SECRET ?? '';
const DB = process.env.DATABASE_URL ?? '';
const HUBSPOT = process.env.HUBSPOT_TOKEN ?? '';
const RESEND = process.env.RESEND_API_KEY ?? '';
const RUN = Date.now().toString(36);

let pass = 0, fail = 0;
const failures: string[] = [];
const out: string[] = [];
const say = (s = '') => { out.push(s); console.log(s); };
const check = (ok: boolean, label: string, detail = '') => {
  ok ? pass++ : (fail++, failures.push(`${label}${detail ? ` (${detail})` : ''}`));
  say(`   ${ok ? '✔' : '✘'} ${label}${detail ? `  (${detail})` : ''}`);
  return ok;
};

const sql = neon(DB);
const row = async (id: string): Promise<any> => (await sql.query('select data from calls where id = $1', [id]))[0]?.data ?? null;
const hook = async (body: unknown, secret = SECRET) => {
  const r = await fetch(`${BASE}/api/vaani/webhook?secret=${encodeURIComponent(secret)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const page = async (p: string) => (await fetch(`${BASE}${p}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })).text();
const hms = (h: number, m: number, s: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
const convo = (turns: ['A' | 'U', string][]) => turns.map(([w, t], i) => `[${hms(11, 0, 2 + i * 6)}] ${w === 'A' ? 'AGENT' : 'USER'}: ${t}`).join('\n');
const GREET: ['A', string] = ['A', 'Good day, Aangan Studio. How can I help you today?'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Poll Neon until every step the call needs has finished. */
async function waitDone(id: string, qualified: boolean, maxMs = 300_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await row(id);
    const q = qualified && r?.route && (r.route === 'qualified' || r.route === 'qualified_flag');
    const done = r && r.status === 'ended' && !r.processing_since && r.route && r.alert?.sent &&
      (!q || (r.consultation && r.hubspot?.deal_id && (!r.consultation.start || r.hubspot.meeting_id || r.hubspot.error) && r.email));
    if (done || Date.now() - t0 > maxMs) return { row: r, ms: Date.now() - t0 };
    await new Promise((x) => setTimeout(x, 4000));
  }
}

type Call = { key: string; title: string; phone: string; name: string; transcript: string; qualified: boolean };
const hubspotGet = async (p: string) => { const r = await fetch(`https://api.hubapi.com${p}`, { headers: { Authorization: `Bearer ${HUBSPOT}` } }); return r.ok ? r.json() : null; };

(async () => {
  say(`Calendar end-to-end test · ${BASE} · run ${RUN}`);
  if (!SECRET || !DB) { say('Missing VAANI_WEBHOOK_SECRET or DATABASE_URL in .env.local'); process.exit(2); }
  const { authMode, busyIntervals, deleteHold, getHold } = await import('../lib/integrations/gcal');
  const { pickSlot, describeSlot, istParts } = await import('../lib/scheduling');
  const cleanup: { eventIds: string[]; callIds: string[] } = { eventIds: [], callIds: [] };

  say('\n0. Before the calls');
  check(authMode() === 'oauth', 'The calendar is connected through OAuth', String(authMode()));
  const health: any = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json();
  const cal = health.checks.find((c: any) => c.id === 'calendar');
  check(cal?.status === 'ok', 'Production reports Google Calendar as working', `${cal?.status} · ${cal?.detail}`);
  const now = new Date();
  const busy0 = await busyIntervals(now, new Date(now.getTime() + 21 * 864e5));
  const free = pickSlot({ now, busy: busy0 })!;
  const askDay = WEEKDAY[istParts(free.start).wd], askHour = istParts(free.start).h;
  const askPhrase = `${askDay} at ${askHour > 12 ? askHour - 12 : askHour} ${askHour >= 12 ? 'pm' : 'am'}`;
  check(!!free, 'A free slot exists to ask for', `${describeSlot(free.start)} -> the callers will ask for "${askPhrase}"`);

  const calls: Call[] = [
    { key: 'A', title: `Asks for a free time (${askPhrase}) and gives an email`, phone: '+919800000051', name: 'Test Calendar Anita',
      qualified: true, transcript: convo([GREET,
        ['U', "Hi, I'm Test Calendar Anita. I have a 3BHK in Baner, about 1,300 sq ft, and I want a full redesign of the kitchen, wardrobes and living room, done by March. I own the flat."],
        ['A', "Which weekday and time suits you for the designer's call, and what is the best email for a confirmation?"],
        ['U', `${askPhrase} works for me. My email is ${OWNER_EMAIL}.`],
        ['A', 'Thank you. The designer will confirm the time and a confirmation email will follow.']]) },
    { key: 'B', title: `A second caller asks for the same time (${askPhrase})`, phone: '+919800000052', name: 'Test Calendar Bhaskar',
      qualified: true, transcript: convo([GREET,
        ['U', "Hello, I'm Test Calendar Bhaskar. I have a 2BHK in Kothrud, about 900 sq ft. I want the whole flat designed and executed, by April. I'm the owner."],
        ['A', "Which weekday and time suits you for the designer's call?"],
        ['U', `${askPhrase} please.`],
        ['A', 'Thank you. The designer will confirm the time.']]) },
    { key: 'C', title: 'Asks for a Saturday, which is not a working day', phone: '+919800000053', name: 'Test Calendar Chitra',
      qualified: true, transcript: convo([GREET,
        ['U', "Hi, this is Test Calendar Chitra. I have a 3BHK in Aundh, 1,100 sq ft, full home design and execution, ready by March. I decide."],
        ['A', "Which weekday and time suits you for the designer's call?"],
        ['U', 'Saturday at 11 am would be best for me.'],
        ['A', 'Thank you. The designer will confirm the time.']]) },
    { key: 'D', title: 'Names no time at all', phone: '+919800000054', name: 'Test Calendar Dev',
      qualified: true, transcript: convo([GREET,
        ['U', "Good morning, I'm Test Calendar Dev. I have a villa in Kalyani Nagar, about 3,000 sq ft, and want complete interiors, finished by April. I am the owner."],
        ['A', "Which weekday and time suits you for the designer's call?"],
        ['U', 'Anytime is fine, I leave it to you.'],
        ['A', 'Thank you. The designer will confirm the time.']]) },
    { key: 'E', title: 'Outside the service area (Nashik)', phone: '+919800000055', name: 'Test Calendar Esha',
      qualified: false, transcript: convo([GREET,
        ['U', "Hello, Test Calendar Esha here. I have a 2BHK in Nashik and want the whole home redesigned."],
        ['A', 'We only work in Pune and PCMC. This may not be the right fit right now, but please reach out if that changes.'],
        ['U', 'Understood, thank you.']]) },
  ];

  say('\nSending the 5 calls (one at a time, so each sees the calendar the previous one left)…');
  const done: Record<string, any> = {};
  for (const c of calls) {
    const id = `cal-e2e-${RUN}-${c.key.toLowerCase()}`;
    cleanup.callIds.push(id);
    const at = new Date(Date.now() - 4 * 60e3).toISOString();
    await hook({ event: 'call_started', timestamp: at, data: { call_id: id, room_name: id, call_type: 'Inbound', phone_number: c.phone } });
    await hook({ event: 'call_ended', timestamp: at, data: { call_id: id, room_name: id, end_reason: 'completed', call_duration: 150 } });
    const ack = await hook({ event: 'call_postprocessing', call_id: id, timestamp: new Date().toISOString(), data: { call_id: id, call_duration: 150000, transcript: c.transcript } });
    const w = await waitDone(id, c.qualified);
    done[c.key] = { c, id, r: w.row, ack, secs: Math.round(w.ms / 1000) };
    if (w.row?.consultation?.event_id) cleanup.eventIds.push(w.row.consultation.event_id);
    say(`   ${c.key}: ${w.row?.route ?? 'no result'} · ${w.row?.consultation?.start ? describeSlot(new Date(w.row.consultation.start)) : w.row?.consultation?.skipped ?? 'no hold'} (${Math.round(w.ms / 1000)} s)`);
  }

  try {
    const holds: { key: string; start: Date; end: Date }[] = [];
    for (const k of ['A', 'B', 'C', 'D']) {
      const { c, id, r, ack, secs } = done[k];
      say(`\n${k}. ${c.title}   [${c.phone}]`);
      if (!check(!!r, 'The call was stored')) continue;
      check(ack.status === 200 && ack.json?.status === 'accepted', 'The webhook acknowledged the post-call event at once');
      check(secs < 290, 'Background processing finished', `${secs} s`);
      check(r.engine === 'gemini', 'Triage ran on Gemini', r.engine);
      check(r.route === 'qualified' || r.route === 'qualified_flag', 'Routed as a qualified lead', r.route);
      check(!!r.fields?.name && r.fields.name.includes(c.name.split(' ').pop()!), 'Name extracted', r.fields?.name);

      const cs = r.consultation;
      check(cs?.calendar === 'google' && !!cs.event_id && !cs.error, 'A REAL Google hold was created (not the mock)', cs?.error ?? `${cs?.calendar}`);
      check(!!cs?.link && cs.link.includes('google.com/calendar'), 'The hold has a Google Calendar link');
      if (cs?.event_id) {
        const ev: any = await getHold(cs.event_id).catch((e) => ({ error: String(e) }));
        check(!ev.error && ev.status === 'tentative', 'Google confirms the event exists and is tentative', ev.error ?? ev.status);
        check(String(ev.summary ?? '').startsWith('HOLD · Consultation call'), 'Event title is “HOLD · Consultation call · …”', ev.summary);
        check(!ev.attendees?.length, 'No attendees were added, so Google emails nobody');
        check(String(ev.description ?? '').includes(`/calls/${id}`) && String(ev.description).includes(r.caller_number), 'Event description carries the phone number and a link to the call page');
        check(new Date(ev.start?.dateTime).getTime() === new Date(cs.start).getTime() && new Date(ev.end?.dateTime).getTime() - new Date(ev.start?.dateTime).getTime() === 3600e3, 'Event runs for exactly one hour at the stored time', `${ev.start?.dateTime}`);
        const around = await busyIntervals(new Date(new Date(cs.start).getTime() - 60e3), new Date(new Date(cs.end).getTime() + 60e3));
        check(around.some((b) => b.start <= new Date(cs.start) && b.end >= new Date(cs.end)), 'The slot now shows as busy time on the real calendar');
        holds.push({ key: k, start: new Date(cs.start), end: new Date(cs.end) });
        const p = istParts(new Date(cs.start));
        check(p.wd >= 1 && p.wd <= 5 && p.h >= 10 && p.h + 1 <= 19, 'On a working day, inside office hours', `${WEEKDAY[p.wd]} ${p.h}:00`);
        check(new Date(cs.start).getTime() - Date.now() >= 17 * 3600e3, 'At least 18 hours ahead');
      }
      if (k === 'A') {
        check(cs?.source === 'preferred' && new Date(cs.start).getTime() === free.start.getTime(), 'Exactly the time the caller asked for was used', `${cs?.source} ${cs?.start ? describeSlot(new Date(cs.start)) : ''}`);
        check(!!r.fields?.preferred_time, 'The preferred time was captured', r.fields?.preferred_time);
      }
      if (k === 'B') {
        check(cs?.source === 'next_free', 'Same time requested: the app did NOT double-book, it moved to the next free slot', `${cs?.source}`);
        const a = done.A.r.consultation;
        check(cs?.start && a?.start && !(new Date(cs.start) < new Date(a.end) && new Date(a.start) < new Date(cs.end)), 'Caller B’s hold does not overlap caller A’s', `${describeSlot(new Date(cs.start))} vs ${describeSlot(new Date(a.start))}`);
      }
      if (k === 'C') check(cs?.source === 'next_free' && !!r.fields?.preferred_time, 'The Saturday request was moved to a working day', `${r.fields?.preferred_time} -> ${cs?.start ? describeSlot(new Date(cs.start)) : ''}`);
      if (k === 'D') check(!r.fields?.preferred_start && cs?.source === 'next_free', 'No time named: the next free slot was chosen');

      check(!!r.hubspot?.deal_id && !r.hubspot?.mock && !r.hubspot?.error, 'HubSpot deal created (real)', r.hubspot?.deal_id ?? r.hubspot?.error);
      if (r.hubspot?.deal_id && HUBSPOT) {
        const d: any = await hubspotGet(`/crm/v3/objects/deals/${r.hubspot.deal_id}?properties=description`);
        check(!!d?.properties?.description?.includes('Consultation call (tentative)'), 'The HubSpot deal names the tentative consultation time');
      }
      check(!!r.hubspot?.meeting_id && !String(r.hubspot.meeting_id).startsWith('mock'), 'HubSpot meeting logged for the consultation', r.hubspot?.meeting_id ?? r.hubspot?.error);
      if (r.hubspot?.meeting_id && HUBSPOT) {
        const m: any = await hubspotGet(`/crm/v3/objects/meetings/${r.hubspot.meeting_id}?properties=hs_meeting_start_time&associations=deals`);
        check((m?.associations?.deals?.results ?? []).some((x: any) => String(x.id) === String(r.hubspot.deal_id)), 'The meeting is attached to the deal');
        check(!!m && Math.abs(new Date(m.properties.hs_meeting_start_time).getTime() - new Date(cs?.start).getTime()) < 60e3, 'The meeting starts at the same time as the Google hold');
      }
      check(r.alert?.sent === true && !r.alert.mock && !r.alert.error, 'Telegram accepted the handoff note (real)');

      if (k === 'A') {
        check(r.fields?.email === OWNER_EMAIL, 'Email address taken from the call', r.fields?.email);
        check(r.email?.sent === true && !r.email.mock && !!r.email.id, 'A REAL confirmation email was sent through Resend', r.email?.error ?? r.email?.id);
        if (r.email?.id && RESEND) {
          let status = '';
          for (let i = 0; i < 10; i++) {
            const s: any = await (await fetch(`https://api.resend.com/emails/${r.email.id}`, { headers: { Authorization: `Bearer ${RESEND}` } })).json();
            status = s.last_event;
            if (['delivered', 'bounced', 'complained', 'failed'].includes(status)) break;
            await new Promise((x) => setTimeout(x, 3000));
          }
          check(status === 'delivered', 'Resend reports the email delivered to the inbox of ' + OWNER_EMAIL, status);
        }
      } else {
        check(!r.email?.sent && !!r.email?.skipped, 'No email address given: skipped, not failed', r.email?.skipped);
      }

      const html = await page(`/calls/${id}`);
      check(html.includes('Calendar hold') && html.includes('tentative') && !/tentative \(mock\)/.test(html), 'The call page shows the real calendar hold (not mock)');
      check(html.includes('calendar.google.com') || html.includes('google.com/calendar'), 'The call page links to the event in Google Calendar');
    }

    say(`\nE. ${done.E.c.title}   [${done.E.c.phone}]`);
    const e = done.E.r;
    check(e?.route === 'close_gracefully', 'Closed kindly', e?.route);
    check(!e?.consultation && !e?.email && !e?.hubspot?.deal_id, 'No calendar hold, no email, no deal for a call that did not qualify');
    check(e?.alert?.sent === true, 'The designers were still told (so a human can overturn a close)');

    say('\nAcross all the holds');
    holds.sort((a, b) => a.start.getTime() - b.start.getTime());
    const overlap = holds.some((h, i) => i > 0 && holds[i].start < holds[i - 1].end);
    check(holds.length === 4 && !overlap, 'Four real holds, none overlapping', holds.map((h) => `${h.key}:${describeSlot(h.start)}`).join(' | '));
    const stuck = (await sql.query("select count(*)::int as n from calls where data->>'status' = 'in_progress' and id like $1", [`cal-e2e-${RUN}-%`]))[0].n;
    check(stuck === 0, 'No call was left half-processed');
  } finally {
    say('\nCleaning up');
    let removed = 0;
    for (const id of cleanup.eventIds) { try { await deleteHold(id); removed++; } catch (e) { say(`   ! could not delete event ${id}: ${(e as Error).message}`); fail++; } }
    check(removed === cleanup.eventIds.length, `Deleted all ${cleanup.eventIds.length} test events from the Google calendar`, `${removed}`);
    if (cleanup.eventIds.length) {
      const after = await busyIntervals(new Date(), new Date(Date.now() + 21 * 864e5));
      const still = after.filter((b) => busy0.every((o) => o.start.getTime() !== b.start.getTime()));
      check(still.length === 0, 'The calendar is back exactly as it was (no test blocks left)', `${still.length} extra`);
    }
    await sql.query('delete from calls where id = any($1)', [cleanup.callIds]);
    say('   removed the test calls from the dashboard log');
  }

  const deals = Object.values(done).map((d: any) => d.r?.hubspot?.deal_id).filter(Boolean);
  say(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} checks passed, ${fail} failed`);
  if (failures.length) { say('\nFailed checks:'); failures.forEach((f) => say(`  ✘ ${f}`)); }
  say(`\nLeft behind for you: ${deals.length} HubSpot deals with meetings (${deals.join(', ')}), 5 Telegram notes, and one email in ${OWNER_EMAIL}.`);
  fs.writeFileSync('calendar-e2e-report.txt', out.join('\n'));
  process.exit(fail === 0 ? 0 : 1);
})();
