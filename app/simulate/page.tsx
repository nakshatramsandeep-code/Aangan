import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { simulatorEnabled } from '@/lib/env';
import Link from 'next/link';
import { Topbar } from '@/components/Topbar';
import Simulator from './Simulator';

export default function SimulatePage() {
  if (!simulatorEnabled) notFound();
  const fixtures = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'phone-transcripts.json'), 'utf8'));
  return (
    <>
      <Topbar />
      <div className="container">
        <Link href="/" className="back">← Dashboard</Link>
        <div className="page-title"><div><h1>Simulate a call</h1><p className="meta">Local only. Runs a transcript through the real pipeline: triage, log, Telegram, HubSpot.</p></div></div>
      <Simulator fixtures={fixtures} />
      </div>
    </>
  );
}
