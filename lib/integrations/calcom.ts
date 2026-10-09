import { config } from '../config';
import type { BookingInfo } from '../types';

const live = () => !!(config.cal.key && config.cal.eventTypeId);

/** Next few working-day slots, used until Cal.com keys exist. */
function mockSlots(): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < 6) {
    d.setDate(d.getDate() + 1);
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(d);
    if (wd === 'Sat' || wd === 'Sun') continue;
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    for (const hm of ['11:00', '15:00']) if (out.length < 6) out.push(new Date(`${ymd}T${hm}:00+05:30`).toISOString());
  }
  return out;
}

export async function getSlots(): Promise<{ slots: string[]; mock: boolean }> {
  if (!live()) return { slots: mockSlots(), mock: true };
  const start = new Date();
  const end = new Date(Date.now() + 7 * 864e5);
  const qs = new URLSearchParams({
    eventTypeId: config.cal.eventTypeId,
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: config.cal.timezone,
  });
  const res = await fetch(`https://api.cal.com/v2/slots?${qs}`, {
    headers: { Authorization: `Bearer ${config.cal.key}`, 'cal-api-version': '2024-09-04' },
  });
  if (!res.ok) throw new Error(`Cal.com slots ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const days: Record<string, { start: string }[]> = json.data ?? {};
  const slots = Object.values(days).flat().map((s) => s.start).slice(0, 6);
  return { slots, mock: false };
}

/** Cal.com needs an email on every booking and rejects ones that cannot receive mail. */
function fallbackEmail(phone?: string): string {
  const base = config.cal.fallbackEmail;
  if (!base.includes('@')) throw new Error('No caller email and CAL_FALLBACK_EMAIL is not set');
  const [local, domain] = base.split('@');
  const digits = (phone || '').replace(/\D/g, '');
  return digits ? `${local}+${digits}@${domain}` : base;
}

export async function createBooking(args: {
  start: string;
  name: string;
  phone?: string;
  email?: string;
}): Promise<BookingInfo> {
  const base = { start: args.start, attendee_name: args.name, booked_at: new Date().toISOString() };
  if (!live()) return { provider: 'mock', booking_id: `mock-${Date.now()}`, ...base };

  const email = args.email || fallbackEmail(args.phone);
  const res = await fetch('https://api.cal.com/v2/bookings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cal.key}`,
      'cal-api-version': '2024-08-13',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      start: args.start,
      eventTypeId: Number(config.cal.eventTypeId),
      attendee: {
        name: args.name,
        email,
        timeZone: config.cal.timezone,
        ...(args.phone ? { phoneNumber: args.phone } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`Cal.com booking ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return { provider: 'calcom', booking_id: String(json.data?.uid ?? json.data?.id), ...base };
}
