import type { ReactNode } from 'react';

/** Yellow "shout" band for inner pages. The dashboard builds its own bigger hero. */
export function PageHero({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="hero rise">
      <p className="kicker">{kicker}</p>
      <h1 className="title">{title}</h1>
      {children && <p className="lede" style={{ fontSize: 16 }}>{children}</p>}
    </div>
  );
}

const NAMES = ['Vaani', 'Gemini', 'Neon', 'Vercel', 'Telegram', 'HubSpot'];

/** Monochrome integrations ticker that closes every page, in the void. */
export function Ticker() {
  const row = [...NAMES, ...NAMES, ...NAMES, ...NAMES];
  return (
    <div className="ticker">
      <div className="cap">Powered by</div>
      <div className="ticker-track" aria-hidden>
        {row.map((n, i) => <span key={i}>{n}</span>)}
      </div>
    </div>
  );
}
