/**
 * Offline tests for the scheduling, calendar, email and pipeline logic. No network, no real keys:
 *   npm run unit
 */
import { generateKeyPairSync, createVerify } from 'node:crypto';
import fs from 'node:fs';

// Never let a unit test reach a real service, whatever is in .env.local.
for (const k of ['DATABASE_URL', 'GEMINI_API_KEY', 'HUBSPOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'RESEND_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_CALENDAR_ID']) process.env[k] = '';
process.env.APP_URL = 'https://example.test';

let pass = 0, fail = 0;
const group = (n: string) => console.log(`\n${n}`);
function ok(cond: unknown, label: string, detail = '') {
  cond ? pass++ : fail++;
  console.log(`   ${cond ? '✔' : '✘'} ${label}${!cond && detail ? `  (${detail})` : ''}`);
}
const IST = (iso: string) => new Date(`${iso}+05:30`);

(async () => {
  const { pickSlot, withinOfficeHours, describeSlot, istParts } = await import('../lib/scheduling');
  const { signJwt } = await import('../lib/integrations/gcal');
  const { buildEmail, validEmail, sendConfirmation } = await import('../lib/integrations/resend');
  const { cleanEmail, triage } = await import('../lib/triage');
  const { isTestCall, holdConsultation } = await import('../lib/consultation');
  const { buildNote } = await import('../lib/integrations/telegram');

  // 2026-10-12 is a Monday.
  const MON_9 = IST('2026-10-12T09:00:00');
  const FRI_17 = IST('2026-10-16T17:00:00');

  group('Office hours and time zone');
  ok(istParts(IST('2026-10-12T22:30:00')).wd === 1 && istParts(IST('2026-10-12T22:30:00')).h === 22, 'IST wall-clock parts');
  ok(withinOfficeHours(IST('2026-10-13T10:00:00'), 60), 'Tuesday 10:00 is in hours');
  ok(withinOfficeHours(IST('2026-10-13T18:00:00'), 60), 'Tuesday 18:00-19:00 fits before closing');
  ok(!withinOfficeHours(IST('2026-10-13T18:30:00'), 60), '18:30 would run past 19:00');
  ok(!withinOfficeHours(IST('2026-10-13T09:30:00'), 60), '09:30 is before opening');
  ok(!withinOfficeHours(IST('2026-10-17T11:00:00'), 60), 'Saturday is not a working day');
  ok(describeSlot(IST('2026-10-13T11:00:00')).includes('Tuesday') && describeSlot(IST('2026-10-13T11:00:00')).includes('IST'), 'Slot is described in words', describeSlot(IST('2026-10-13T11:00:00')));

  group('Picking the consultation slot');
  let s = pickSlot({ now: MON_9, preferred: IST('2026-10-14T15:00:00'), busy: [] })!;
  ok(s.source === 'preferred' && s.start.getTime() === IST('2026-10-14T15:00:00').getTime(), 'A free preferred time is used');
  s = pickSlot({ now: MON_9, preferred: IST('2026-10-12T11:00:00'), busy: [] })!;
  ok(s.source === 'next_free' && s.start >= new Date(MON_9.getTime() + 18 * 3600e3), 'A preferred time inside the 18 h lead window is refused', s.start.toISOString());
  s = pickSlot({ now: MON_9, preferred: IST('2026-10-17T11:00:00'), busy: [] })!;
  ok(s.source === 'next_free' && istParts(s.start).wd === 1 && istParts(s.start).h === 10, 'A Saturday preference moves to Monday 10:00', describeSlot(s.start));
  s = pickSlot({ now: MON_9, preferred: IST('2026-10-14T15:00:00'), busy: [{ start: IST('2026-10-14T14:30:00'), end: IST('2026-10-14T15:30:00') }] })!;
  ok(s.source === 'next_free', 'A busy preferred time falls back to the next free slot', describeSlot(s.start));
  ok(s.start >= IST('2026-10-14T15:30:00'), 'The fallback starts after the busy block', describeSlot(s.start));
  s = pickSlot({ now: MON_9, busy: [] })!;
  ok(describeSlot(s.start) === describeSlot(IST('2026-10-13T10:00:00')), 'No preference: the first slot after the lead window (Tue 10:00)', describeSlot(s.start));
  s = pickSlot({ now: FRI_17, busy: [] })!;
  ok(istParts(s.start).wd === 1, 'Late on Friday the next slot is on Monday, not the weekend', describeSlot(s.start));
  const allDay = (d: string) => ({ start: IST(`${d}T00:00:00`), end: IST(`${d}T23:59:00`) });
  s = pickSlot({ now: MON_9, busy: [allDay('2026-10-13'), allDay('2026-10-14')] })!;
  ok(istParts(s.start).day === 15, 'Fully booked days are skipped', describeSlot(s.start));
  const busyAll = Array.from({ length: 16 }, (_, i) => allDay(`2026-10-${String(12 + i).padStart(2, '0')}`));
  ok(pickSlot({ now: MON_9, busy: busyAll }) === null, 'Nothing free for two weeks returns no slot');
  s = pickSlot({ now: MON_9, preferred: new Date('invalid'), busy: [] })!;
  ok(!!s, 'An invalid preferred time is ignored');

  group('Google sign-in (service account JWT)');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = signJwt({ client_email: 'bot@proj.iam.gserviceaccount.com', private_key: pem }, 1_800_000_000);
  const [h, c, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  ok(JSON.parse(Buffer.from(h, 'base64url').toString()).alg === 'RS256', 'Header says RS256');
  ok(claims.iss === 'bot@proj.iam.gserviceaccount.com' && claims.scope.endsWith('/auth/calendar') && claims.aud === 'https://oauth2.googleapis.com/token', 'Claims: issuer, calendar scope, token audience');
  ok(claims.exp - claims.iat === 3600, 'Token lasts one hour');
  const v = createVerify('RSA-SHA256').update(`${h}.${c}`);
  ok(v.verify(publicKey, Buffer.from(sig, 'base64url')), 'The signature verifies against the public key');

  group('Reading an email address');
  ok(cleanEmail('Meera.Iyer@Gmail.com') === 'meera.iyer@gmail.com', 'Written address, lower-cased');
  ok(cleanEmail('meera dot iyer at gmail dot com') === 'meera.iyer@gmail.com', 'Spoken “dot” and “at”');
  ok(cleanEmail('meera at gmail') === undefined, 'An incomplete address is rejected');
  ok(cleanEmail('not an email') === undefined, 'Free text is rejected');
  ok(!validEmail('a@b') && validEmail('a@b.co') && !validEmail(undefined), 'Validation basics');
  const hh = await triage({ transcript: 'Caller: Hi, I am Meera. My email is meera dot iyer at gmail dot com, 3BHK in Baner, by March.' });
  ok(hh.fields.email === 'meera.iyer@gmail.com', 'The fallback reader finds a spoken email in a transcript', String(hh.fields.email));

  group('The rule-based fallback (used when Gemini is slow or down)');
  const r01 = await triage({ transcript: ['Caller: I have a two BHK which I want to renovate, with a lot of furnishing, to make it look good.', 'Front Desk: May I have your name and where is it?', 'Caller: My name is Srikar. And it is in Baner.', 'Caller: I want it done within two months because of my housewarming. Two months max.'].join('\n') });
  const dR = (await import('../lib/triage')).decideRoute(r01);
  ok(r01.engine === 'heuristic', 'This test really ran on the fallback');
  ok(r01.criteria.timeline.status === 'pass', '“two months” (spelled as a word) is a workable timeline', r01.criteria.timeline.status);
  ok(r01.criteria.real_project.status === 'pass', '“renovate … furnishing” is recognised as a project', r01.criteria.real_project.status);
  ok(dR.route === 'qualified' && r01.fields.name === 'Srikar', 'The two-month caller is qualified and named correctly', `${dR.route} ${r01.fields.name}`);
  const short = await triage({ transcript: 'Caller: I want my living room redone in three weeks for guests. I am in Baner.' });
  ok(short.criteria.timeline.status === 'fail', 'Three weeks is still closed kindly', short.criteria.timeline.status);

  group('Reading a preferred day and time');
  const { parsePreferred } = await import('../lib/triage');
  const FRI = IST('2026-10-09T11:20:00'); // a Friday
  const p1 = parsePreferred('Thursday at 3 pm works for me', FRI);
  ok(p1?.preferred_start === IST('2026-10-15T15:00:00').toISOString(), '“Thursday at 3 pm” on a Friday is the following Thursday 15:00', p1?.preferred_start);
  const p2 = parsePreferred('tomorrow morning would be good', FRI);
  ok(p2?.preferred_start === IST('2026-10-10T11:00:00').toISOString(), '“tomorrow morning” is 11:00 the next day', p2?.preferred_start);
  const p3 = parsePreferred('How about Monday at 11:30 am?', FRI);
  ok(p3?.preferred_start === IST('2026-10-12T11:30:00').toISOString(), '“Monday at 11:30 am”', p3?.preferred_start);
  ok(parsePreferred('Tuesday around 4', FRI)?.preferred_start === IST('2026-10-13T16:00:00').toISOString(), 'A bare “4” in office hours means 4 pm');
  ok(parsePreferred('Friday afternoon', FRI)?.preferred_start === IST('2026-10-16T15:00:00').toISOString(), 'Saying the weekday it already is means next week');
  ok(parsePreferred('whenever is fine', FRI) === null, 'No day and time: nothing');
  ok(parsePreferred('Thursday works', FRI) === null, 'A day without a time of day: nothing');
  const p4 = parsePreferred('Thursday evening', FRI);
  ok(p4?.preferred_time === 'thursday evening' && !p4.preferred_start, 'An evening is noted but not turned into a time');
  ok(parsePreferred('I have a 3BHK of 1,200 sq ft, done by March', FRI) === null, 'Sizes and months are not mistaken for a time');

  group('The customer email');
  const base: any = { id: 'x1', created_at: new Date().toISOString(), status: 'ended', route: 'qualified', flags: [], after_hours: false, fields: { name: 'Meera Iyer', email: 'meera@example.com', locality: 'Baner', area_sqft: 1200, project_type: 'residential', scope: 'kitchen, wardrobes', completion_date: 'by March' } };
  let m = buildEmail({ ...base, consultation: { calendar: 'google', start: IST('2026-10-13T11:00:00').toISOString(), end: IST('2026-10-13T12:00:00').toISOString() } });
  ok(m.html.includes('Hi Meera,') && m.text.includes('Hi Meera,'), 'Greets by first name (html and text)');
  ok(m.html.includes('Tuesday') && m.html.includes('tentative'), 'Names the tentative time when a hold exists');
  ok(m.html.includes('Baner') && m.html.includes('1,200 sq ft'), 'Repeats what was noted');
  ok(!/₹|lakh|per sq|rs\.?\s?\d/i.test(m.html + m.text), 'Contains no price or rate');
  m = buildEmail(base);
  ok(!m.html.includes('tentative') && m.html.includes('shortly'), 'Promises no time when no hold exists');
  m = buildEmail({ ...base, fields: { ...base.fields, name: '<script>alert(1)</script> Bob' } });
  ok(!m.html.includes('<script>'), 'HTML in a name is escaped');
  ok((await sendConfirmation({ ...base, fields: { name: 'X' } }, { mock: false })).skipped !== undefined, 'No address: skipped, not failed');
  const mailMock = await sendConfirmation(base, { mock: true });
  ok(mailMock.sent && mailMock.mock && mailMock.to === 'meera@example.com', 'Mock mode records a send without calling Resend');

  group('Test callers never reach real services');
  ok(isTestCall({ caller_number: '+919999900201' }) && isTestCall({ caller_number: '+91 99999 00105' }), 'Reserved fake numbers are recognised');
  ok(!isTestCall({ caller_number: '+919876543210' }) && !isTestCall({ caller_number: 'web-user' }), 'Real numbers are not');
  const c1 = await holdConsultation({ ...base, caller_number: '+919999900201' }, true);
  ok(c1.calendar === 'mock' && !!c1.start, 'A test call gets a mock hold');
  const c2 = await holdConsultation({ ...base, caller_number: '+919876543210' }, false);
  ok(c2.calendar === 'none' && !c2.start && !!c2.skipped, 'A real call with no calendar connected gets no hold and no promised time');

  group('The pipeline, end to end, in mock mode');
  const { callEnded } = await import('../lib/pipeline');
  const { getCall } = await import('../lib/db');
  const tr = [
    '[10:00:01] AGENT: Good day, Aangan Studio.',
    '[10:00:05] USER: Hi, I am Meera Iyer. I have a 3BHK in Baner, about 1,200 sq ft, and I want a full redesign with the kitchen and wardrobes, done by March. I own it.',
    '[10:00:20] AGENT: Which weekday and time suits you for the designer’s call?',
    '[10:00:24] USER: Tuesday afternoon is fine. My email is meera dot iyer at gmail dot com.',
  ].join('\n');
  const r1 = await callEnded({ callId: 'unit-test-1', callerNumber: '+919999900301', transcript: tr, durationSec: 120 });
  ok(r1.route === 'qualified', 'Routed qualified', String(r1.route));
  ok(r1.fields?.email === 'meera.iyer@gmail.com', 'Email extracted from the call', String(r1.fields?.email));
  ok(r1.consultation?.calendar === 'mock' && !!r1.consultation.start, 'Calendar hold made (mock, test caller)');
  ok(r1.hubspot?.deal_id?.startsWith('mock-deal') && !!r1.hubspot.meeting_id, 'Deal created and the consultation logged on it');
  ok(r1.email?.sent === true && r1.email.mock && r1.email.to === 'meera.iyer@gmail.com', 'Confirmation email recorded');
  ok(r1.alert?.sent === true, 'Designer note sent');
  const note = buildNote(r1);
  ok(note.includes('Calendar hold') && note.includes('meera.iyer@gmail.com'), 'The designer note shows the hold and the email');
  const again = await callEnded({ callId: 'unit-test-1', callerNumber: '+919999900301', transcript: tr + '\n[10:00:30] USER: also', durationSec: 120 });
  ok(JSON.stringify(again.consultation) === JSON.stringify(r1.consultation) && again.email?.at === r1.email?.at && again.hubspot?.meeting_id === r1.hubspot?.meeting_id, 'A redelivery repeats nothing');
  const real = await callEnded({ callId: 'unit-test-2', callerNumber: '+919876543210', transcript: tr, durationSec: 120 });
  ok(real.consultation?.calendar === 'none' && !real.hubspot?.meeting_id, 'Real caller, no calendar: no hold, no meeting logged');
  ok(real.email?.sent === true && !buildEmail(real).html.includes('tentative'), 'Real caller still gets an email that promises no time');
  const closed = await callEnded({ callId: 'unit-test-3', callerNumber: '+919999900302', transcript: tr.replace('Baner', 'Nashik'), durationSec: 90 });
  ok(closed.route === 'close_gracefully' && !closed.consultation && !closed.email, 'A closed call gets no hold and no email');
  const saved = await getCall('unit-test-1');
  ok(saved?.consultation?.start === r1.consultation?.start, 'Everything is stored on the call');

  fs.rmSync('.data', { recursive: true, force: true });
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
