import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Ticker } from '@/components/Hero';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Aangan Studio · Phone enquiries',
  description: 'Every call answered, every worthy lead handed to a designer with everything already asked.',
};

/** Each page renders <Shout>…hero…</Shout> then <div className="wrap">…</div>. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <Ticker />
      </body>
    </html>
  );
}
