import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { simulatorEnabled } from '@/lib/env';
import Simulator from './Simulator';

export default function SimulatePage() {
  if (!simulatorEnabled) notFound();
  const fixtures = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'phone-transcripts.json'), 'utf8'));
  return (
    <>
      <h1>Simulate a call</h1>
      <p className="sub">
        Pushes a transcript through the same pipeline a real call uses: triage, route, log row, Telegram, HubSpot.
        Anything not connected yet runs in mock mode. Pick one of the 19 real September phone transcripts, or paste your own.
      </p>
      <Simulator fixtures={fixtures} />
    </>
  );
}
