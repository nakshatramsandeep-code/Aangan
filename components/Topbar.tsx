import Link from 'next/link';
import type { ReactNode } from 'react';

/** The only chrome: a thin bar with the product name and an optional right-hand note. */
export function Topbar({ right }: { right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand">Aangan Studio <span>Phone enquiries</span></Link>
        {right && <div className="topbar-right">{right}</div>}
      </div>
    </header>
  );
}
