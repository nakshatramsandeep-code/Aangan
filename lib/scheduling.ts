import { config } from './config';

export interface Interval { start: Date; end: Date }
export interface Slot { start: Date; end: Date; source: 'preferred' | 'next_free' }

const IST = 5.5 * 3600e3; // India has no daylight saving, so a fixed offset is exact
const HOUR = 3600e3;

/** Wall-clock parts of an instant in IST. */
export function istParts(d: Date) {
  const t = new Date(d.getTime() + IST);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), day: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), wd: t.getUTCDay() }; // wd: 0 = Sunday
}
/** The instant for a given IST wall-clock hour. */
const at = (y: number, mo: number, day: number, h: number) => new Date(Date.UTC(y, mo, day, h, 0, 0) - IST);
const isWorkday = (wd: number) => wd >= 1 && wd <= 5;

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** True when [start, start+minutes) sits inside office hours on a working day, in IST. */
export function withinOfficeHours(start: Date, minutes: number, open = config.rules.openHour, close = config.rules.closeHour) {
  const p = istParts(start);
  const end = istParts(new Date(start.getTime() + minutes * 60e3));
  const sameDay = p.y === end.y && p.mo === end.mo && p.day === end.day;
  const startH = p.h + p.mi / 60;
  const endH = end.h + end.mi / 60;
  return isWorkday(p.wd) && sameDay && startH >= open && endH <= close;
}

/**
 * Picks the consultation hold. The caller's preferred time wins if it is in office hours, far enough
 * ahead and free. Otherwise it is the first free hour, from the preferred day (or the earliest allowed
 * moment) onwards. Pure: busy intervals come in as data, so this is fully testable.
 */
export function pickSlot(opts: {
  now: Date;
  preferred?: Date | null;
  busy: Interval[];
  minutes?: number;
  leadHours?: number;
  open?: number;
  close?: number;
  searchDays?: number;
}): Slot | null {
  const minutes = opts.minutes ?? config.consult.minutes;
  const lead = opts.leadHours ?? config.consult.leadHours;
  const open = opts.open ?? config.rules.openHour;
  const close = opts.close ?? config.rules.closeHour;
  const earliest = new Date(opts.now.getTime() + lead * HOUR);
  const free = (s: Date) => {
    const iv = { start: s, end: new Date(s.getTime() + minutes * 60e3) };
    return !opts.busy.some((b) => overlaps(iv, b));
  };

  const pref = opts.preferred && !isNaN(opts.preferred.getTime()) ? opts.preferred : null;
  // Nobody is given a time inside the lead window, or a month out.
  if (pref && pref >= earliest && pref.getTime() - opts.now.getTime() < 30 * 24 * HOUR && withinOfficeHours(pref, minutes, open, close) && free(pref)) {
    return { start: pref, end: new Date(pref.getTime() + minutes * 60e3), source: 'preferred' };
  }

  const from = pref && pref > earliest ? pref : earliest;
  const p0 = istParts(from);
  for (let d = 0; d < (opts.searchDays ?? 14); d++) {
    const day = new Date(Date.UTC(p0.y, p0.mo, p0.day + d));
    if (!isWorkday(day.getUTCDay())) continue;
    for (let h = open; h + minutes / 60 <= close; h++) {
      const s = at(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h);
      if (s >= from && free(s)) return { start: s, end: new Date(s.getTime() + minutes * 60e3), source: 'next_free' };
    }
  }
  return null;
}

/** "Tuesday 13 October, 11:00 am IST" */
export function describeSlot(d: Date) {
  const date = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}, ${time} IST`;
}
