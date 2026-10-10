/**
 * Ten different kinds of call, each checked on every function, then the dashboard as a whole.
 *
 *   npm run suite                          -> https://aangan-gamma.vercel.app
 *   npm run suite -- http://localhost:3000
 *
 * Plays Vaani (call_started, call_ended, call_postprocessing). Test callers are named "Test ..." and use
 * +91 99999 002xx. Real side effects: Telegram notes in the designers' group, and HubSpot deals for the
 * qualified calls. Telegram can only be checked as "accepted by Telegram"; you confirm the notes by eye.
 */
import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p))
    for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

const BASE = (process.argv[2] || 'https://aangan-gamma.vercel.app').replace(/\/$/, '');
const SECRET = process.env.VAANI_WEBHOOK_SECRET ?? '';
const DB = process.env.DATABASE_URL ?? '';
const HUBSPOT = process.env.HUBSPOT_TOKEN ?? '';
const STARTED = Date.now();
const RUN = STARTED.toString(36);
const ONLY = (process.argv[3] ?? '').split(',').map((x) => Number(x)).filter(Boolean);

let pass = 0, fail = 0;
const failures: string[] = [];
const out: string[] = [];
const say = (s = '') => { out.push(s); console.log(s); };
const check = (ok: boolean, label: string, detail = '') => {
  ok ? pass++ : (fail++, failures.push(`${label}${detail ? ` (${detail})` : ''}`));
  say(`   ${ok ? '✔' : '✘'} ${label}${detail ? `  (${detail})` : ''}`);
  return ok;
};

const hook = async (body: unknown) => {
  const res = await fetch(`${BASE}/api/vaani/webhook?secret=${encodeURIComponent(SECRET)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(110_000) });
  let json: any = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};
const row = async (id: string): Promise<any> => ((await neon(DB).query('select data from calls where id = $1', [id]))[0]?.data) ?? null;
const page = async (p: string) => (await fetch(`${BASE}${p}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })).text();


/** The webhook answers at once and triages in the background, so poll Neon until the call is fully processed. */
async function waitDone(id: string, maxMs = 240_000): Promise<{ row: any; ms: number }> {
  const t0 = Date.now();
  for (;;) {
    const r = await row(id);
    const q = r && (r.route === 'qualified' || r.route === 'qualified_flag');
    const done = r && r.status === 'ended' && !r.processing_since &&
      (r.silent || (r.route && (r.alert?.sent || r.alert?.error) && (!q || r.hubspot?.deal_id || r.hubspot?.error)));
    if (done || Date.now() - t0 > maxMs) return { row: r, ms: Date.now() - t0 };
    await new Promise((res) => setTimeout(res, 3000));
  }
}

/** The most recent Monday-Friday at hh:mm IST, as ISO. */
function weekdayAt(hh: number, mm: number) {
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(d);
    if (wd !== 'Sat' && wd !== 'Sun') break;
    d.setDate(d.getDate() - 1);
  }
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  return new Date(`${ymd}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`).toISOString();
}
const hms = (hh: number, mm: number, ss: number) => `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
/** Builds "[hh:mm:ss] AGENT: …" lines, 6 s apart, as Vaani sends them. */
function convo(hh: number, mm: number, turns: ['A' | 'U', string][]) {
  return turns.map(([w, text], i) => `[${hms(hh, mm, 2 + i * 6)}] ${w === 'A' ? 'AGENT' : 'USER'}: ${text}`).join('\n');
}

type Expect = {
  email?: string; preferred?: boolean; hold?: boolean; noEmail?: boolean;
  route?: string; silent?: boolean; deal?: boolean; afterHours: boolean;
  name?: string; locality?: string; area?: number; type?: string;
  leak?: boolean; flagged?: boolean; urgent?: boolean;
};
type Call = { n: number; title: string; phone: string; at: string; secs: number; transcript: string; expect: Expect };

const GREET: ['A', string] = ['A', 'Good day, Aangan Studio. How can I help you today?'];
const CALLS: Call[] = [
  {
    n: 1, title: 'Qualified home, caller pushes for a price and the agent deflects', phone: '+919999900201', at: weekdayAt(11, 20), secs: 270,
    transcript: convo(11, 20, [GREET,
      ['U', "Hi, I'm Test Priya Nair. We have a 3BHK in Kothrud, about 1,400 sq ft, and we want a full redesign of the kitchen, living room and both bedrooms."],
      ['A', 'That is a complete project. When would you like it finished?'],
      ['U', 'By April. My husband and I own the flat and we are ready to go ahead.'],
      ['U', 'Can you tell me roughly what it costs per square foot?'],
      ['A', 'Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation.'],
      ['U', 'Okay, fair enough.'],
      ['A', 'Which weekday and time suits you for the designer\'s call, and what is the best email for a confirmation?'],
      ['U', 'Thursday at 3 pm works for me. My email is test dot priya dot nair at example dot com.'],
      ['A', 'Thank you. The designer will confirm the time and a confirmation email will follow.']]),
    expect: { route: 'qualified', deal: true, afterHours: false, name: 'Priya', locality: 'Kothrud', area: 1400, type: 'residential', leak: false, email: 'test.priya.nair@example.com', preferred: true, hold: true },
  },
  {
    n: 2, title: 'Qualified small office, called after hours', phone: '+919999900202', at: weekdayAt(22, 10), secs: 230,
    transcript: convo(22, 10, [GREET,
      ['U', "Hello, this is Test Vikram. I run a startup and we have a bare shell office of about 1,200 sq ft in Hinjewadi Phase 1. We need workstations for 25 people, a cabin and a meeting room."],
      ['A', 'Good scope for us. When do you need it operational?'],
      ['U', 'By January 20. I am the founder, so I decide.'],
      ['A', 'Wonderful. A designer will call you to arrange the free consultation.']]),
    expect: { route: 'qualified', deal: true, afterHours: true, name: 'Vikram', locality: 'Hinjewadi', area: 1200, type: 'commercial', leak: false, hold: true, noEmail: true },
  },
  {
    n: 3, title: 'Qualified with a flag: son researching for his parents, in Hinglish', phone: '+919999900203', at: weekdayAt(14, 40), secs: 255,
    transcript: convo(14, 40, [GREET,
      ['U', 'Namaste, main Test Rahul bol raha hoon. Mere parents ka 3BHK Hadapsar mein hai, naya possession mila hai. Poora interior karwana hai, March tak complete chahiye.'],
      ['A', 'Zaroor. Kya aap decision lene wale hain?'],
      ['U', 'Nahi, main sirf initial research kar raha hoon. Parents hi final decision lenge, wo phone use nahi karte.'],
      ['A', 'Theek hai. Ek designer aapko consultation arrange karne ke liye call karenge.']]),
    expect: { route: 'qualified_flag', deal: true, afterHours: false, name: 'Rahul', locality: 'Hadapsar', flagged: true, leak: false, hold: true, noEmail: true },
  },
  {
    n: 4, title: 'Incomplete: wants a kitchen redo but hangs up before giving a timeline', phone: '+919999900204', at: weekdayAt(10, 45), secs: 95,
    transcript: convo(10, 45, [GREET,
      ['U', "Hi, I'm Test Sneha. I have a 2BHK in Aundh and want the kitchen and two wardrobes redone, full design with execution."],
      ['A', 'Good. When would you need it completed?'],
      ['U', 'Hmm, I have not decided yet. Let me check with my family and call back.']]),
    expect: { route: 'ask_question', deal: false, afterHours: false, name: 'Sneha', locality: 'Aundh', leak: false },
  },
  {
    n: 5, title: 'Outside the service area (Nashik)', phone: '+919999900205', at: weekdayAt(12, 5), secs: 140,
    transcript: convo(12, 5, [GREET,
      ['U', "Hi, Test Suresh here. I have a 2BHK in Nashik and I want the whole home redesigned. Can you take it up?"],
      ['A', 'Thank you for calling. We only work in Pune and PCMC because our execution depends on our own vendor network. This may not be the right fit right now, but please reach out if that changes.'],
      ['U', 'Alright, understood.']]),
    expect: { route: 'close_gracefully', deal: false, afterHours: false, name: 'Suresh', leak: false },
  },
  {
    n: 6, title: 'Advice only, no execution', phone: '+919999900206', at: weekdayAt(15, 25), secs: 125,
    transcript: convo(15, 25, [GREET,
      ['U', "Hi, I'm Test Anil. I live in Baner. I'm just looking for some ideas on colours and furniture arrangement for my living room. I'll do the work myself, I only want suggestions."],
      ['A', 'We are a full-service studio, so our projects include design and execution together. We do not do advice-only visits. This may not be the right fit right now.'],
      ['U', 'Okay, no problem.']]),
    expect: { route: 'close_gracefully', deal: false, afterHours: false, name: 'Anil', leak: false },
  },
  {
    n: 7, title: 'Timeline too short (three weeks)', phone: '+919999900207', at: weekdayAt(16, 10), secs: 150,
    transcript: convo(16, 10, [GREET,
      ['U', "Hello, Test Divya here. I have a 2BHK in Wakad. I want the living room and kitchen fully redesigned, but I need it all ready in three weeks because guests are arriving."],
      ['A', 'Design takes a few weeks and execution follows, so we could not do justice to a project needed that soon. This may not be the right fit right now.'],
      ['U', 'I see, thanks.']]),
    expect: { route: 'close_gracefully', deal: false, afterHours: false, name: 'Divya', leak: false },
  },
  {
    n: 8, title: 'Budget far too low, and the agent echoes a number (guardrail)', phone: '+919999900208', at: weekdayAt(13, 35), secs: 170,
    transcript: convo(13, 35, [GREET,
      ['U', "Hi, I'm Test Rohit. I have a 1BHK in Kharadi, about 550 sq ft, and I want the kitchen and one bedroom fully redone. My budget is 1 to 1.5 lakh in total."],
      ['A', 'A kitchen and bedroom with full execution would cost significantly more than 1 to 1.5 lakh, so I would not want to bring you to a consultation where the numbers do not align.'],
      ['U', 'Okay, thanks for being straight.']]),
    expect: { route: 'close_gracefully', deal: false, afterHours: false, name: 'Rohit', leak: true },
  },
  {
    n: 9, title: 'Complaint about an unanswered enquiry, escalated to a human', phone: '+919999900209', at: weekdayAt(15, 55), secs: 210,
    transcript: convo(15, 55, [GREET,
      ['U', "This is Test Anita. I called on Monday about my 3BHK in Viman Nagar and nobody called me back. This is not acceptable. I want a senior person to call me."],
      ['A', 'I am very sorry about that. I am flagging this to a senior person right now so that they call you back. Can I confirm your name and number?'],
      ['U', 'Anita, and yes, this number is fine.']]),
    expect: { route: 'escalate', deal: false, afterHours: false, name: 'Anita', urgent: true, leak: false },
  },
  {
    n: 10, title: 'Silent call: the line connects and nobody speaks', phone: '+919999900210', at: weekdayAt(10, 20), secs: 18,
    transcript: convo(10, 20, [GREET, ['A', 'Hello?']]),
    expect: { silent: true, deal: false, afterHours: false },
  },
];

async function runCall(c: Call) {
  const id = `suite-${RUN}-${String(c.n).padStart(2, '0')}`;
  const L: string[] = [];
  const t = (ok: boolean, label: string, detail = '') => { L.push(`${ok ? '✔' : '✘'} ${label}${detail ? `  (${detail})` : ''}`); ok ? pass++ : (fail++, failures.push(`#${c.n} ${label}${detail ? ` (${detail})` : ''}`)); return ok; };
  const t0 = Date.now();
  const s1 = await hook({ event: 'call_started', timestamp: c.at, data: { call_id: id, room_name: id, call_type: 'Inbound', agent_name: 'Aangan', phone_number: c.phone } });
  const s2 = await hook({ event: 'call_ended', timestamp: c.at, data: { call_id: id, room_name: id, end_reason: 'completed', call_duration: c.secs, technical_issue: false } });
  const t3 = Date.now();
  const s3 = await hook({ event: 'call_postprocessing', call_id: id, timestamp: c.at, data: { call_id: id, summary: '', entities: {}, dispositions: {}, recording_url: '', call_duration: c.secs * 1000, transcript: c.transcript } });
  const ackMs = Date.now() - t3;
  t(s1.status === 200 && s2.status === 200, 'Webhook accepted call_started and call_ended');
  t(s3.status === 200 && s3.json?.status === 'accepted' && ackMs < 5000, 'Webhook acknowledged the post-call event at once', `HTTP ${s3.status}, ${ackMs} ms for the post-call request`);
  const done = await waitDone(id);
  t(done.ms < 235_000, 'Background processing finished', `${(done.ms / 1000).toFixed(0)} s after the acknowledgement`);

  const r = done.row;
  if (!t(!!r, 'Neon: call stored')) return { c, id, r: null, L };
  const e = c.expect;
  t(r.caller_number === c.phone, 'Neon: caller number from call_started', r.caller_number);
  t(r.after_hours === e.afterHours, `Neon: after-hours is ${e.afterHours}`);
  t(r.duration_sec === c.secs && (r.voice_cost_inr ?? 0) > 0, 'Cost: duration and voice cost recorded', `${r.duration_sec}s · ₹${r.voice_cost_inr}`);

  if (e.silent) {
    t(r.silent === true && !r.route, 'Silent call recognised, not triaged', `route=${r.route ?? 'none'}`);
    t(!r.alert && !r.hubspot && (r.ai_cost_inr ?? 0) === 0, 'No Telegram, no HubSpot, no Gemini cost');
    return { c, id, r, L };
  }
  t(r.engine === 'gemini', 'Triage ran on Gemini', r.engine);
  t(r.route === e.route, `Route is ${e.route}`, `got ${r.route}`);
  if (e.name) t(!!r.fields?.name && r.fields.name.includes(e.name), 'Extracted name', r.fields?.name);
  if (e.locality) t(!!r.fields?.locality && r.fields.locality.toLowerCase().includes(e.locality.toLowerCase()), 'Extracted locality', r.fields?.locality);
  if (e.area) t(Number(r.fields?.area_sqft) === e.area, 'Extracted size', String(r.fields?.area_sqft));
  if (e.type) t(r.fields?.project_type === e.type, `Project type is ${e.type}`, r.fields?.project_type);
  t(!!r.criteria && Object.keys(r.criteria).length === 5, 'All five criteria evaluated');
  t(typeof r.summary === 'string' && r.summary.length > 20, 'Summary written');
  if (e.flagged !== undefined) t((r.flags?.length > 0) === e.flagged, e.flagged ? 'Designer flag present' : 'No flag', r.flags?.[0]?.slice(0, 70));
  if (e.leak !== undefined) t(!!r.price_leak?.length === e.leak, e.leak ? 'Guardrail flagged a number the agent said' : 'Guardrail: agent said no price', r.price_leak?.[0]?.slice(0, 50));
  t(r.alert?.sent === true && r.alert?.mock === false && !r.alert?.error, 'Telegram accepted the handoff note (real)');
  if (e.deal) {
    const did = r.hubspot?.deal_id;
    t(!!did && r.hubspot?.mock === false && !r.hubspot?.error, 'HubSpot deal created (real)', did ?? r.hubspot?.error);
    if (did && HUBSPOT) {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${did}?properties=dealname,dealstage,description`, { headers: { Authorization: `Bearer ${HUBSPOT}` } });
      const d: any = res.ok ? await res.json() : null;
      t(!!d, 'HubSpot deal read back from HubSpot', d ? d.properties.dealname : `HTTP ${res.status}`);
      if (d && e.flagged) t(/Flags:/.test(d.properties.description ?? ''), 'HubSpot deal description carries the flag');
      if (d) t(/\/calls\//.test(d.properties.description ?? ''), 'HubSpot deal links back to the call page');
    }
  } else {
    t(!r.hubspot?.deal_id, 'No HubSpot deal (not qualified)');
  }
  if (e.hold) {
    t(!!r.consultation?.start && r.consultation.calendar === 'mock', 'Calendar hold made (mock: test callers never touch a real calendar)', r.consultation?.start);
    if (r.consultation?.start) {
      const when = new Date(r.consultation.start);
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(when);
      const wd = p.find((x) => x.type === 'weekday')?.value, hr = Number(p.find((x) => x.type === 'hour')?.value) % 24;
      t(wd !== 'Sat' && wd !== 'Sun' && hr >= 10 && hr <= 18, 'Hold is on a working day inside office hours', `${wd} ${hr}:00`);
      t(when.getTime() - Date.now() >= 17 * 3600e3, 'Hold respects the 18 h lead time');
      if (e.preferred) t(r.consultation.source === 'preferred', 'The caller’s preferred time (Thursday 3 pm) was used', `${r.consultation.source}; preferred_time=${r.fields?.preferred_time}; preferred_start=${r.fields?.preferred_start}`);
    }
    t(!!r.hubspot?.meeting_id && !String(r.hubspot.meeting_id).startsWith('mock'), 'HubSpot: consultation logged as a meeting (real)', r.hubspot?.meeting_id ?? r.hubspot?.error);
    if (r.hubspot?.meeting_id && HUBSPOT) {
      const mr = await fetch(`https://api.hubapi.com/crm/v3/objects/meetings/${r.hubspot.meeting_id}?properties=hs_meeting_title&associations=deals`, { headers: { Authorization: `Bearer ${HUBSPOT}` } });
      const md: any = mr.ok ? await mr.json() : null;
      t(!!md && (md.associations?.deals?.results ?? []).some((x: any) => String(x.id) === String(r.hubspot.deal_id)), 'HubSpot: the meeting is attached to the deal', md ? md.properties.hs_meeting_title : `HTTP ${mr.status}`);
    }
  }
  if (e.email) {
    t(r.fields?.email === e.email, 'Email address extracted from the spoken words', r.fields?.email);
    t(r.email?.sent === true && r.email.mock === true && r.email.to === e.email, 'Customer email recorded (mock: test callers never email a real address)', r.email?.error ?? r.email?.to);
  }
  if (e.noEmail) t(!r.email?.sent && !!r.email?.skipped, 'No email address given: skipped, not failed', r.email?.skipped);
  return { c, id, r, L };
}

/** Runs async jobs with limited concurrency, keeping results in order. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

(async () => {
  say(`Ten-call test suite · ${BASE} · run ${RUN}`);
  if (!SECRET || !DB) { say('Missing VAANI_WEBHOOK_SECRET or DATABASE_URL in .env.local'); process.exit(2); }

  say('\nBefore the calls');
  const h: any = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json();
  for (const x of h.checks) check(x.status !== 'down', `Health: ${x.name}`, `${x.status} · ${x.detail}`);
  const bad = await fetch(`${BASE}/api/vaani/webhook?secret=wrong`, { method: 'POST', body: '{}' });
  check(bad.status === 401, 'Webhook rejects a wrong secret', `HTTP ${bad.status}`);

  say('\nRunning the 10 calls (3 at a time)…');
  const chosen = ONLY.length ? CALLS.filter((c) => ONLY.includes(c.n)) : CALLS;
  const results = await pool(chosen, 3, runCall);
  for (const x of results) { say(`\n#${x.c.n}  ${x.c.title}   [${x.c.phone}]`); x.L.forEach((l) => say(`   ${l}`)); }

  if (ONLY.length) {
    say(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} checks passed, ${fail} failed (calls ${ONLY.join(', ')} only)`);
    if (failures.length) { say('\nFailed checks:'); failures.forEach((f) => say(`  ✘ ${f}`)); }
    fs.writeFileSync('suite-report.txt', out.join('\n'));
    process.exit(fail === 0 ? 0 : 1);
  }

  /* ---------- whole-dashboard checks ---------- */
  say('\nDashboard as a whole');
  const get = Object.fromEntries(results.map((x) => [x.c.n, x]));
  const html = await page('/');
  const num = (p: string) => p.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
  for (const x of results) {
    // The silent call is deliberately kept off the main list (it has its own tab).
    const want = !x.c.expect.silent;
    check(html.includes(num(x.c.phone)) === want, want ? `Dashboard lists call #${x.c.n}` : `Dashboard keeps the silent call #${x.c.n} off the main list`, num(x.c.phone));
  }
  const stat = (label: string) => { const m = html.match(new RegExp(`${label}</div>.*?stat-v">(?:<!-- -->)?([^<]+)`)); return m?.[1]?.trim(); };
  check(stat('Conversations') === '9', 'Conversations stat counts 9 (the silent call is excluded)', stat('Conversations'));
  check(html.includes('1 silent call excluded'), 'Silent call is reported as excluded');
  check(stat('Qualified') === '33%', 'Qualified is 33% (3 of 9, flagged leads included)', stat('Qualified'));
  check(stat('After hours') === '1', 'After-hours stat counts 1', stat('After hours'));
  check(html.includes('Show') === false, 'All 9 calls fit on the first page');

  const view = async (q: string, has: number[], hasNot: number[], label: string) => {
    const p = await page(q);
    const ok = has.every((n) => p.includes(num(get[n].c.phone))) && hasNot.every((n) => !p.includes(num(get[n].c.phone)));
    check(ok, `Filter ${label}`, `${has.map((n) => '#' + n).join(',')} shown; ${hasNot.length ? hasNot.map((n) => '#' + n).join(',') + ' hidden' : ''}`);
  };
  await view('/?f=qualified', [1, 2], [3, 4, 5, 9, 10], 'Qualified');
  await view('/?f=qualified_flag', [3], [1, 2, 4, 5, 9], 'Qualified, flagged');
  await view('/?f=ask_question', [4], [1, 2, 3, 5, 9], 'Incomplete');
  await view('/?f=close_gracefully', [5, 6, 7, 8], [1, 2, 3, 4, 9], 'Closed kindly');
  await view('/?f=escalate', [9], [1, 2, 3, 4, 5, 6, 7, 8], 'Escalated');
  await view('/?f=silent', [10], [1, 2, 3, 4, 5, 6, 7, 8, 9], 'No conversation');
  await view('/?f=price', [8], [1, 2, 3, 4, 5, 6, 7, 9], 'Possible price quoted');
  await view('/?q=Kothrud', [1], [2, 3, 4, 5, 9], 'Search “Kothrud”');
  await view('/?q=%2B91%2099999%2000209', [9], [1, 2, 3, 4, 5], 'Search by phone number');
  await view('/?days=7', [1, 2, 3, 4, 5, 6, 7, 8, 9], [], '7-day period');

  say('\nCall pages');
  for (const x of results) {
    const p = await page(`/calls/${x.id}`);
    const lead = x.c.expect.silent ? 'No conversation' : x.c.expect.route === 'escalate' ? 'Escalated' : null;
    check(p.includes(x.c.transcript.split('\n')[0].replace(/^\[[\d:]+\]\s*(AGENT|USER):\s*/, '').slice(0, 14)) && p.includes('Conversation'), `Call #${x.c.n} page shows the transcript`);
    if (lead) check(p.includes(lead), `Call #${x.c.n} page shows “${lead}”`);
  }
  const p3 = await page(`/calls/${get[3].id}`);
  check(p3.includes('For the designer'), 'Call #3 page shows the designer flag');
  const p8 = await page(`/calls/${get[8].id}`);
  check(p8.includes('may have quoted a price'), 'Call #8 page shows the price warning');

  say('\nHubSpot and Telegram, across the whole suite');
  if (HUBSPOT) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', { method: 'POST', headers: { Authorization: `Bearer ${HUBSPOT}`, 'content-type': 'application/json' }, body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(STARTED) }] }], limit: 50, properties: ['dealname'] }) });
    const d: any = await res.json();
    check((d.results ?? []).length === 3, 'Exactly 3 deals created (calls #1, #2, #3), none for the other 7', `${(d.results ?? []).length}: ${(d.results ?? []).map((x: any) => x.properties.dealname).join(' | ')}`);
  }
  const sent = results.filter((x) => x.r?.alert?.sent && !x.r?.alert?.mock).length;
  check(sent === 9, 'Telegram accepted 9 notes (every call where someone spoke), none for the silent call', `${sent}`);
  const after: any = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json();
  check(after.status === 'ok', 'Every pipeline stage is still healthy after the run', after.checks.map((c: any) => `${c.name}:${c.status}`).join(' '));

  say(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} checks passed, ${fail} failed`);
  if (failures.length) { say('\nFailed checks:'); failures.forEach((f) => say(`  ✘ ${f}`)); }
  fs.writeFileSync('suite-report.txt', out.join('\n'));
  process.exit(fail === 0 ? 0 : 1);
})();
