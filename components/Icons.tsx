const PATHS: Record<string, string> = {
  arch: 'M5 21V11a7 7 0 0 1 14 0v10M2.5 21h19',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  moon: 'M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.8 6.8 0 0 0 9.7 9.7z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  help: 'M9.4 9.2a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.3 1-1.3 1.9M12 17.2h.01',
  alert: 'M12 9v4.2M12 17h.01M10.4 4.2L2.8 17.6A2 2 0 0 0 4.5 20.6h15a2 2 0 0 0 1.7-3L13.6 4.2a2 2 0 0 0-3.2 0z',
  clock: 'M12 7.5V12l3 2',
  search: 'M20 20l-4.2-4.2',
  up: 'M7 17L17 7M8.5 7H17v8.5',
  down: 'M7 7l10 10M17 8.5V17H8.5',
  flat: 'M5 12h14',
  send: 'M21.5 2.5L10.5 13.5M21.5 2.5l-6.8 19-4.2-8-8-4.2z',
  briefcase: 'M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7',
  rupee: 'M7 4.5h10.5M7 9h10.5M9.5 4.5c4.7 0 6.3 2 5.7 4.6-.6 2.6-3.2 3.6-6 3.6l7 7',
  back: 'M15 18l-6-6 6-6',
  zap: 'M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z',
  message: 'M20.5 15.5a2 2 0 0 1-2 2H8l-4.5 3.5V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z',
  user: 'M4.5 20a7.5 7.5 0 0 1 15 0M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
};
const CIRCLES: Record<string, [number, number, number]> = { help: [12, 12, 9.2], clock: [12, 12, 9], search: [11, 11, 6.8], briefcase: [0, 0, 0] };

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const c = CIRCLES[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {c && c[2] > 0 && <circle cx={c[0]} cy={c[1]} r={c[2]} />}
      {name === 'briefcase' && <rect x="3" y="7" width="18" height="13" rx="2.5" />}
      <path d={PATHS[name]} />
    </svg>
  );
}
