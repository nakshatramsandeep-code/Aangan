import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { simulatorEnabled } from '@/lib/env';
import { Shout } from '@/components/Header';
import { PageHero } from '@/components/Hero';
import Simulator from './Simulator';

export default function SimulatePage() {
  if (!simulatorEnabled) notFound();
  const fixtures = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'phone-transcripts.json'), 'utf8'));
  return (
    <>
      <Shout>
        <PageHero kicker="Local only" title="Simulate a call">
          Pushes a transcript through the same pipeline a real call uses: triage, route, log row, Telegram, HubSpot. Pick one of the 19 real September phone transcripts, or paste your own.
        </PageHero>
      </Shout>
      <div className="wrap">
      <Simulator fixtures={fixtures} />
      </div>
    </>
  );
}
