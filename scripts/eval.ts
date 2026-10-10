/**
 * Runs the real phone transcripts through triage + routing and compares with the expected route.
 *   npm run eval            -> uses Gemini if GEMINI_API_KEY is set, else the rule-based fallback
 * Expected routes follow qualified.md. T18 (180 sq ft pod) never states a locality or timeline, so the
 * agent should ask, not decline: the rubric has no minimum commercial size.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p))
    for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

const fixtures = JSON.parse(fs.readFileSync('fixtures/phone-transcripts.json', 'utf8')) as {
  id: string; date: string; time: string; transcript: string; expected?: string;
}[];

// "3 September" + "2:41pm" -> a Date in IST, year 2026 (the September 2026 enquiry set)
const fixtureDate = (f: { date: string; time: string }) => {
  const [d, mon] = f.date.split(' ');
  const [, h, m, ap] = f.time.match(/(\d+):(\d+)(am|pm)/)!;
  const hh = (Number(h) % 12) + (ap === 'pm' ? 12 : 0);
  return new Date(`${mon} ${d}, 2026 ${String(hh).padStart(2, '0')}:${m}:00+05:30`);
};

(async () => {
  // Imported after the env files are loaded: lib/config reads process.env at import time.
  const { detectPriceLeak } = await import('../lib/guardrails');
  const { decideRoute, splitTranscript, triage } = await import('../lib/triage');
  let ok = 0, n = 0;
  for (const f of fixtures) {
    if (!f.expected) {
      console.log(`${f.id}  (no transcript: missed call)`);
      continue;
    }
    const t = await triage({ transcript: f.transcript, asOf: fixtureDate(f) });
    const d = decideRoute(t);
    const pass = f.expected.split('|').includes(d.route);
    n++; if (pass) ok++;
    const leak = detectPriceLeak(splitTranscript(f.transcript).agent).length ? ' [agent echoed a number]' : '';
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${f.id}  got=${d.route.padEnd(16)} want=${f.expected.padEnd(16)} ${pass ? '' : JSON.stringify(Object.fromEntries(Object.entries(t.criteria).map(([k, v]) => [k, v.status])))}${leak}`);
  }
  console.log(`\n${ok}/${n} routes match (${(await triage({ transcript: 'x' })).engine} engine)`);
  process.exit(ok === n ? 0 : 1);
})();
