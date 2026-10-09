import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './Icons';

/** Sticky bar: brand on the left, whatever the page needs on the right. */
export function Topbar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Aangan phone desk, home">
          <span className="mark"><Icon name="arch" size={18} /></span>
          <span className="brand-name">Aangan</span>
          <span className="brand-sub">Phone desk</span>
        </Link>
        <div className="topbar-right">{children}</div>
      </div>
    </header>
  );
}
