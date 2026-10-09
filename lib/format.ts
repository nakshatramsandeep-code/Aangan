export const inr = (n: number) => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
export const inrExact = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: n < 100 ? 2 : 0 })}`;
export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '-');

/** "5 min ago", "3 h ago", "Yesterday", "9 Oct". */
export function ago(iso: string, now = Date.now()) {
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
  if (m < 60 * 48) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}

export const initials = (name?: string) =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

/** +91 98765 43210 style, when it looks like an Indian mobile; otherwise as given. */
export function phone(n?: string) {
  if (!n) return '';
  const d = n.replace(/\D/g, '');
  if (n.startsWith('+91') && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return n;
}

/** Signed percentage-point or relative change for the stat cards. */
export function delta(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (!prev && !cur) return null;
  if (!prev) return { text: 'New', dir: 'up' };
  const p = Math.round(((cur - prev) / prev) * 100);
  return { text: `${p > 0 ? '+' : ''}${p}%`, dir: p > 0 ? 'up' : p < 0 ? 'down' : 'flat' };
}
