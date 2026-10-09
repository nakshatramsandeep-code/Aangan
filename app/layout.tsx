import type { Metadata } from 'next';
import Link from 'next/link';
import { simulatorEnabled } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aangan Studio · Phone enquiries',
  description: 'Every call answered, every worthy lead handed to a designer with everything already asked.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <b>Aangan Studio · Phone enquiries</b>
          <nav>
            <Link href="/">Dashboard</Link>
            {simulatorEnabled && <Link href="/simulate">Simulate a call</Link>}
            <Link href="/setup">Setup</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
