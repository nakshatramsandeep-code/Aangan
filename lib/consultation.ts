import { config } from './config';
import { busyIntervals, createHold, gcalLive } from './integrations/gcal';
import { describeSlot, pickSlot } from './scheduling';
import type { CallRow, Consultation } from './types';

/**
 * Calls from our reserved fake numbers (+91 99999 00xxx, used by the e2e and suite tests) never touch a
 * real calendar or send a real email, whatever keys are configured. Everything else behaves normally.
 */
export const isTestCall = (c: Pick<CallRow, 'caller_number'>) => /^\+?919999900\d{3}$/.test((c.caller_number ?? '').replace(/\s/g, ''));

/**
 * Blocks the designer's time for the consultation call. The caller's preferred time is used when it is in
 * office hours, far enough ahead and free in the calendar; otherwise the next free hour.
 * With no calendar connected (and not a test), nothing is blocked and no time is promised to anyone.
 */
export async function holdConsultation(call: CallRow, test: boolean): Promise<Consultation> {
  const live = gcalLive() && !test;
  if (!live && !test) return { calendar: 'none', skipped: 'Google Calendar is not connected' };

  const now = new Date();
  const preferred = call.fields?.preferred_start ? new Date(call.fields.preferred_start) : null;
  const busy = live ? await busyIntervals(now, new Date(now.getTime() + 21 * 24 * 3600e3)) : [];
  const slot = pickSlot({ now, preferred, busy });
  if (!slot) return { calendar: live ? 'google' : 'mock', skipped: 'No free slot in the next two weeks' };

  const base = { start: slot.start.toISOString(), end: slot.end.toISOString(), source: slot.source };
  if (!live) return { calendar: 'mock', ...base };

  const f = call.fields ?? {};
  const ev = await createHold({
    start: slot.start,
    end: slot.end,
    summary: `HOLD · Consultation call · ${f.name ?? 'New lead'}`,
    description: [
      'Tentative hold made by the phone desk. Confirm the time with the customer.',
      '',
      `Name: ${f.name ?? '-'}`,
      `Phone: ${call.caller_number ?? '-'}`,
      f.email ? `Email: ${f.email}` : '',
      `Project: ${[f.project_type, f.scope].filter(Boolean).join(': ') || '-'}`,
      `Location: ${f.locality ?? '-'}${f.area_sqft ? ` · ${f.area_sqft} sq ft` : ''}`,
      f.completion_date ? `Timeline: ${f.completion_date}` : '',
      f.preferred_time ? `Caller asked for: ${f.preferred_time}${slot.source === 'preferred' ? ' (used)' : ' (not available, next free slot used)'}` : '',
      call.flags.length ? `Flags: ${call.flags.join('; ')}` : '',
      '',
      call.summary ?? '',
      '',
      `Call log: ${config.appUrl}/calls/${call.id}`,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
  });
  return { calendar: 'google', ...base, event_id: ev.id, link: ev.link };
}

export const holdLabel = (c?: Consultation) => (c?.start ? describeSlot(new Date(c.start)) : '');
