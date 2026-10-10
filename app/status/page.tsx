import Link from 'next/link';
import { Suspense } from 'react';
import { Icon } from '@/components/Icons';
import { SystemStatus, SystemStatusSkeleton } from '@/components/SystemStatus';
import { Topbar } from '@/components/Topbar';
import { listCalls, listEvents } from '@/lib/db';
import { ago } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export default async function StatusPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const { fresh } = await searchParams;
  const [calls, events] = await Promise.all([listCalls(50), listEvents(8)]);

  return (
    <>
      <Topbar />
      <main className="container">
        <Link href="/" className="back"><Icon name="back" size={15} />Dashboard</Link>
        <div className="page-title">
          <div>
            <h1>Pipeline status</h1>
            <p className="meta">Every stage a call passes through, checked live. A broken stage dims the ones after it.</p>
          </div>
        </div>

        <Suspense fallback={<SystemStatusSkeleton />}><SystemStatus calls={calls} fresh={!!fresh} /></Suspense>

        <section className="card section-card" aria-labelledby="h-ev">
          <div className="card-head">
            <div><h2 id="h-ev" className="card-title">Recent events from Vaani</h2><p className="card-sub">What the webhook received and what it did with it</p></div>
            <Link className="link" href="/setup">Webhook setup</Link>
          </div>
          <div className="log">
            {events.length === 0 && <div className="empty"><b>Nothing received yet</b>Add the webhook URL in Vaani, then make a test call.</div>}
            {events.map((e, i) => (
              <div className="row" key={i}>
                <span>{ago(e.at)}</span>
                <span className="ev">{e.event ?? 'unknown'}</span>
                <span className={e.ok ? '' : 'bad'} style={{ textAlign: 'left' }}>{e.note ?? (e.ok ? 'ok' : 'failed')}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
