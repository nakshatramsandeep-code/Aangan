/**
 * Proves the Google Calendar connection works, using the same code the app uses:
 *   npm run google:check
 * Reads free/busy for the next 7 days, finds the slot the app would pick, creates one tentative test
 * event, reads it back through free/busy, then deletes it. Leaves nothing behind.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
}

(async () => {
  const { authMode, gcalLive, busyIntervals, createHold, deleteHold, checkAccess } = await import('../lib/integrations/gcal');
  const { pickSlot, describeSlot } = await import('../lib/scheduling');
  let bad = 0;
  const step = (ok: boolean, label: string, detail = '') => { if (!ok) bad++; console.log(`${ok ? '✔' : '✘'} ${label}${detail ? `  (${detail})` : ''}`); return ok; };

  step(gcalLive(), `Calendar is configured (${authMode() ?? 'not configured'})`);
  if (!gcalLive()) process.exit(1);
  try { const a = await checkAccess(); step(true, 'Signed in to Google and can read free/busy', a.name); } catch (e) { step(false, 'Sign-in / free-busy', (e as Error).message); process.exit(1); }

  const now = new Date();
  const busy = await busyIntervals(now, new Date(now.getTime() + 7 * 864e5));
  step(true, 'Free/busy for the next 7 days', `${busy.length} busy block(s)`);
  const slot = pickSlot({ now, busy });
  step(!!slot, 'The app can pick a slot', slot ? describeSlot(slot.start) : 'none');
  if (!slot) process.exit(1);

  let id = '';
  try {
    const ev = await createHold({ start: slot.start, end: slot.end, summary: 'TEST hold (delete me): Aangan phone desk check', description: 'Created by npm run google:check and deleted straight away.' });
    id = ev.id; step(true, 'Created a tentative event', ev.link ? 'has a calendar link' : '');
  } catch (e) { step(false, 'Create event', (e as Error).message); process.exit(1); }

  const after = await busyIntervals(new Date(slot.start.getTime() - 60e3), new Date(slot.end.getTime() + 60e3));
  step(after.some((b) => b.start <= slot.start && b.end >= slot.end), 'The event now shows as busy time (the next call will not double-book it)');
  await deleteHold(id);
  const gone = await busyIntervals(new Date(slot.start.getTime() - 60e3), new Date(slot.end.getTime() + 60e3));
  step(!gone.some((b) => b.start <= slot.start && b.end >= slot.end), 'Deleted the test event; nothing left on the calendar');

  console.log(bad === 0 ? '\nGoogle Calendar is connected and working.' : `\n${bad} check(s) failed.`);
  process.exit(bad === 0 ? 0 : 1);
})();
