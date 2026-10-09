import Link from 'next/link';
import type { ReactNode } from 'react';
import { simulatorEnabled } from '@/lib/env';

/** The flat yellow "shout" zone: header on top, the page's hero below, one liquid cut at the bottom. */
export function Shout({ children }: { children: ReactNode }) {
  return (
    <div className="shout">
      <header className="top">
        <Link href="/" className="logo">Aangan<small>Phone enquiries</small></Link>
        <nav>
          <Link href="/" className="navpill">Dashboard</Link>
          {simulatorEnabled && <Link href="/simulate" className="navpill">Simulate</Link>}
          <Link href="/setup" className="navpill">Setup</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
