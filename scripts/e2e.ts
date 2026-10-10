/**
 * End-to-end test of the whole pipeline against a running deployment.
 *
 *   npm run e2e                                  -> https://aangan-gamma.vercel.app
 *   npm run e2e -- http://localhost:3000         -> a local server
 *
 * It plays Vaani: it sends the same events Vaani sends (call_started, call_ended, call_postprocessing)
 * and then checks every stage on its own: HTTP answer, Neon row, HubSpot deal (read back from HubSpot's
 * API), the dashboard, and the health endpoint. Test calls are named "E2E Test ..." and use +91 99999 001xx.
 * What it cannot do is read the Telegram group: it checks that Telegram accepted the message, and
 * you confirm in the group that the notes arrived.
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
const RUN = Date.now().toString(36);

let pass = 0, fail = 0;
const out: string[] = [];
const say = (s = '') => { out.push(s); console.log(s); };
function check(ok: boolean, label: string, detail = '') {
  ok ? pass++ : fail++;
  say(`   ${ok ? '✔' : '✘'} ${label}${detail ? `  (${detail})` : ''}`);
  return ok;
}

/* ---------- helpers ---------- */
const hook = async (body: unknown, secret = SECRET) => {
  const res = await fetch(`${BASE}/api/vaani/webhook?secret=${encodeURIComponent(secret)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
  });
  let json: any = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};
const row = async (id: string): Promise<any> => ((await neon(DB).query('select data from calls where id = $1', [id]))[0]?.data) ?? null;

/** Last Monday-Friday at hh:mm IST as an ISO string (so "in office hours" is true whatever day the test runs). */
function weekdayAt(hh: number, mm: number, wantAfterHours = false) {
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(d);
    if (wd !== 'Sat' && wd !== 'Sun') break;
    d.setDate(d.getDate() - 1);
  }
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  void wantAfterHours;
  return new Date(`${ymd}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`).toISOString();
}

type Scenario = {
  key: string; title: string; id: string; phone: string; at: string; durationMs: number; transcript: string;
  expect: { route?: string; silent?: boolean; deal?: boolean; leak?: boolean; afterHours: boolean; name?: string; locality?: string };
};

const t = (hms: string, who: 'AGENT' | 'USER', text: string) => `[${hms}] ${who}: ${text}`;

const SCENARIOS: Scenario[] = [
  {
    key: 'A', title: 'Qualified lead, after hours', id: `e2e-${RUN}-a`, phone: '+919999900101', at: weekdayAt(21, 40), durationMs: 240_000,
    transcript: [
      t('21:40:02', 'AGENT', 'Good day, Aangan Studio. How can I help you today?'),
      t('21:40:07', 'USER', "Hi, I'm E2E Test Meera. I have a 3BHK in Baner, about 1,200 sq ft, and I want a complete redesign with the kitchen, wardrobes and living room."),
      t('21:40:15', 'AGENT', 'Lovely. When would you need it completed?'),
      t('21:40:20', 'USER', "By the end of March. My husband and I own the flat and we've decided to go ahead."),
      t('21:40:28', 'AGENT', 'Wonderful. A designer will call you to arrange the free consultation.'),
      t('21:40:33', 'USER', 'Great, thank you.'),
    ].join('\n'),
    expect: { route: 'qualified', deal: true, afterHours: true, name: 'Meera', locality: 'Baner' },
  },
  {
    key: 'B', title: 'Outside the service area, in office hours', id: `e2e-${RUN}-b`, phone: '+919999900102', at: weekdayAt(11, 15), durationMs: 150_000,
    transcript: [
      t('11:15:02', 'AGENT', 'Good day, Aangan Studio. How can I help you today?'),
      t('11:15:07', 'USER', "Hello, this is E2E Test Rohan. I have a 3BHK flat in Andheri, Mumbai, and I'd like the whole interior redone."),
      t('11:15:16', 'AGENT', 'Thank you. We only work in Pune and PCMC because our execution depends on our own vendor network. This may not be the right fit right now, but please reach out if that changes.'),
      t('11:15:25', 'USER', 'Understood, thanks.'),
    ].join('\n'),
    expect: { route: 'close_gracefully', deal: false, afterHours: false, name: 'Rohan' },
  },
  {
    key: 'C', title: 'Complaint, must escalate to a human', id: `e2e-${RUN}-c`, phone: '+919999900103', at: weekdayAt(15, 5), durationMs: 200_000,
    transcript: [
      t('15:05:02', 'AGENT', 'Good day, Aangan Studio. How can I help you today?'),
      t('15:05:06', 'USER', "This is E2E Test Anita. I called on Monday about my 3BHK in Viman Nagar and nobody ever called me back. This is not acceptable, I want a senior person to call me."),
      t('15:05:18', 'AGENT', 'I am very sorry about that. I am flagging this to a senior person right now. Can I confirm your name and number?'),
      t('15:05:26', 'USER', 'Anita, yes, this number.'),
    ].join('\n'),
    expect: { route: 'escalate', deal: false, afterHours: false, name: 'Anita' },
  },
  {
    key: 'D', title: 'Out of scope, and the agent quotes a price (guardrail)', id: `e2e-${RUN}-d`, phone: '+919999900104', at: weekdayAt(12, 30), durationMs: 120_000,
    transcript: [
      t('12:30:02', 'AGENT', 'Good day, Aangan Studio. How can I help you today?'),
      t('12:30:06', 'USER', "Hi, E2E Test Karan here. I'm opening a restaurant in Koregaon Park and want the interiors designed. What would it cost?"),
      t('12:30:15', 'AGENT', 'It would cost around 3 lakh, roughly 2,500 rupees per sq ft. Restaurants are outside our scope though.'),
      t('12:30:24', 'USER', 'Okay, thanks.'),
    ].join('\n'),
    expect: { route: 'close_gracefully', deal: false, leak: true, afterHours: false, name: 'Karan' },
  },
  {
    key: 'E', title: 'Silent call (nobody speaks)', id: `e2e-${RUN}-e`, phone: '+919999900105', at: weekdayAt(10, 20), durationMs: 18_000,
    transcript: [t('10:20:02', 'AGENT', 'Good day, Aangan Studio. How can I help you today?'), t('10:20:09', 'AGENT', 'Hello?')].join('\n'),
    expect: { silent: true, deal: false, afterHours: false },
  },
];

async function run(s: Scenario) {
  say(`\n${s.key}. ${s.title}`);
  const room = s.id;
  const started = await hook({ event: 'call_started', timestamp: s.at, data: { call_id: room, room_name: room, call_type: 'Inbound', agent_name: 'Aangan', phone_number: s.phone } });
  check(started.status === 200, 'Vaani → webhook: call_started accepted', `HTTP ${started.status}`);
  const ended = await hook({ event: 'call_ended', timestamp: s.at, data: { call_id: room, room_name: room, end_reason: 'completed', call_duration: Math.round(s.durationMs / 1000), technical_issue: false } });
  check(ended.status === 200, 'Vaani → webhook: call_ended accepted', `HTTP ${ended.status}`);
  const t0 = Date.now();
  const post = await hook({ event: 'call_postprocessing', call_id: room, timestamp: s.at, data: { call_id: room, summary: 'x', entities: {}, dispositions: {}, recording_url: '', call_duration: s.durationMs, transcript: s.transcript } });
  check(post.status === 200 && post.json?.status === 'ok', 'Webhook: call_postprocessing processed', `HTTP ${post.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const r = await row(room);
  if (!check(!!r, 'Neon: row stored')) return null;
  check(r.caller_number === s.phone, 'Neon: caller number carried over from call_started', r.caller_number);
  check(r.after_hours === s.expect.afterHours, `Neon: after-hours flag is ${s.expect.afterHours}`, String(r.after_hours));
  check((r.voice_cost_inr ?? 0) > 0, 'Cost: voice minutes costed', `${r.voice_minutes} min · ₹${r.voice_cost_inr}`);

  if (s.expect.silent) {
    check(r.silent === true && !r.route, 'Triage: silent call recognised, not triaged', `route=${r.route ?? 'none'}`);
    check(!r.alert && !r.hubspot, 'Telegram + HubSpot: nothing sent for a silent call');
    return r;
  }
  check(r.engine === 'gemini', 'Gemini: triage ran on Gemini (not the fallback)', r.engine);
  check(r.route === s.expect.route, `Routing: ${s.expect.route}`, `got ${r.route}`);
  if (s.expect.name) check(!!r.fields?.name && r.fields.name.includes(s.expect.name), 'Extraction: caller name', r.fields?.name);
  if (s.expect.locality) check(r.fields?.locality?.toLowerCase().includes(s.expect.locality.toLowerCase()), 'Extraction: locality', r.fields?.locality);
  check(r.alert?.sent === true && r.alert?.mock === false && !r.alert?.error, 'Telegram: message accepted by Telegram (real, not mock)', r.alert?.error ?? '');
  if (s.expect.leak !== undefined) check(!!r.price_leak?.length === s.expect.leak, 'Guardrail: agent price quote detected', r.price_leak?.[0]?.slice(0, 60));
  if (s.expect.deal) {
    const id = r.hubspot?.deal_id;
    check(!!id && r.hubspot?.mock === false && !r.hubspot?.error, 'HubSpot: deal created (real, not mock)', id ?? r.hubspot?.error);
    if (id && HUBSPOT) {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${id}?properties=dealname,dealstage`, { headers: { Authorization: `Bearer ${HUBSPOT}` } });
      const d: any = res.ok ? await res.json() : null;
      check(!!d, 'HubSpot: deal read back from HubSpot’s own API', d ? `${d.properties.dealname} · ${d.properties.dealstage}` : `HTTP ${res.status}`);
    }
  } else {
    check(!r.hubspot?.deal_id, 'HubSpot: no deal for a non-qualified call');
  }
  return r;
}

(async () => {
  say(`End-to-end test · ${BASE} · run ${RUN}`);
  if (!SECRET || !DB) { say('Missing VAANI_WEBHOOK_SECRET or DATABASE_URL in .env.local'); process.exit(2); }

  say('\n0. Before the calls: security and health');
  const bad = await hook({ event: 'call_started', data: { call_id: 'x' } }, 'wrong-secret');
  check(bad.status === 401, 'Webhook rejects a wrong secret', `HTTP ${bad.status}`);
  const h: any = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json();
  for (const c of h.checks) check(c.status === 'ok' || c.status === 'warn', `Health: ${c.name} reachable`, `${c.status} · ${c.detail}`);

  const results: Record<string, any> = {};
  for (const s of SCENARIOS) results[s.key] = await run(s);

  say('\nF. Retry safety (Vaani redelivers the A post-call event)');
  const a = SCENARIOS[0]; const before = results.A;
  if (before) {
    const again = await hook({ event: 'call_postprocessing', call_id: a.id, timestamp: a.at, data: { call_id: a.id, call_duration: a.durationMs, transcript: a.transcript.replace('Meera', 'Someone Else') } });
    const after = await row(a.id);
    check(again.status === 200, 'Redelivery accepted', `HTTP ${again.status}`);
    check(after.route === before.route && after.hubspot?.deal_id === before.hubspot?.deal_id, 'No second HubSpot deal, route unchanged', after.hubspot?.deal_id);
    check(after.alert?.at === before.alert?.at, 'No second Telegram message', after.alert?.at);
    check(JSON.stringify(after.ai_tokens) === JSON.stringify(before.ai_tokens), 'No second Gemini call (tokens unchanged)');
    if (HUBSPOT) {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', { method: 'POST', headers: { Authorization: `Bearer ${HUBSPOT}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'E2E Test Meera', limit: 20, properties: ['dealname'] }) });
      const d: any = await res.json();
      const mine = (d.results ?? []).filter((x: any) => x.id === before.hubspot?.deal_id).length;
      check(mine === 1, 'HubSpot: exactly one deal for this call', `${mine}`);
    }
  }

  say('\nG. Dashboard');
  const html = await (await fetch(`${BASE}/`, { cache: 'no-store' })).text();
  check(html.includes('Pipeline status'), 'Dashboard shows the pipeline status panel');
  for (const s of SCENARIOS.filter((x) => !x.expect.silent)) {
    const name = results[s.key]?.fields?.name;
    check(!!name && html.includes(name.split(' ')[0]), `Dashboard lists call ${s.key}`, name ?? '');
  }
  for (const s of SCENARIOS) {
    const res = await fetch(`${BASE}/calls/${s.id}`, { cache: 'no-store' });
    check(res.status === 200, `Call page ${s.key} opens`, `HTTP ${res.status}`);
  }

  say(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} checks passed, ${fail} failed`);
  say('\nYou verify by eye:');
  say('  • Telegram group "Client Updates": 4 notes (A qualified, B closed, C urgent, D closed + price warning). E sends nothing.');
  say(`  • HubSpot: one deal named like "E2E Test Meera - Baner residential" (delete it afterwards).`);
  say(`  • Dashboard ${BASE}: calls A–E appear; E under "No conversation".`);
  fs.writeFileSync('e2e-report.txt', out.join('\n'));
  process.exit(fail === 0 ? 0 : 1);
})();
