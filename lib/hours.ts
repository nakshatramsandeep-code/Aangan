import { config } from './config';

/** True when the studio front desk would not be staffed (outside 10am-7pm IST, or a weekend). */
export function isAfterHours(d: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  return hour < config.rules.openHour || hour >= config.rules.closeHour;
}
