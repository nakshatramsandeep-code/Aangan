export const inr = (n: number) => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
export const inrExact = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: n < 100 ? 2 : 0 })}`;
export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '-');
