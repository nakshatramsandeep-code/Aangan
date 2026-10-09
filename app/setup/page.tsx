import Link from 'next/link';
import { Topbar } from '@/components/Topbar';
import { buildAgentPrompt } from '@/lib/agent-prompt';
import { config, integrationStatus } from '@/lib/config';
import { listEvents } from '@/lib/db';
import { when } from '@/lib/format';

export const dynamic = 'force-dynamic';

const Row = ({ name, ok, need }: { name: string; ok: boolean; need: string }) => (
  <div className="row"><span><b>{name}</b> <span className="dim">{need}</span></span><span className={ok ? 'ok' : 'dim'}>{ok ? 'Live' : 'Mock mode'}</span></div>
);

export default async function Setup() {
  const s = integrationStatus();
  const base = config.appUrl;
  const local = /localhost|127\.0\.0\.1/.test(base);
  const events = await listEvents(8);
  return (
    <>
      <Topbar />
      <div className="container">
        <Link href="/" className="back">← Dashboard</Link>
        <div className="page-title"><div><h1>Setup</h1><p className="meta">Each integration goes from mock to live once its keys are in the environment.</p></div></div>
      <div className="card card-pad">
        <Row name="Neon" ok={s.neon} need="DATABASE_URL" />
        <Row name="Gemini Flash" ok={s.gemini} need="GEMINI_API_KEY (rule-based triage until then)" />
        <Row name="HubSpot" ok={s.hubspot} need="HUBSPOT_TOKEN" />
        <Row name="Telegram" ok={s.telegram} need="TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID" />
        <Row name="Vaani webhook secret" ok={s.vaaniSecret} need="VAANI_WEBHOOK_SECRET (the webhook is open in dev, closed in production without it)" />
      </div>

      <h2 className="section">Vaani dashboard checklist</h2>
      <div className="card card-pad">
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li><b>Create the agent</b>: paste the prompt below, pick an Indian English voice, language English (or Hindi if you want).</li>
          <li><b>Telephony</b>: Settings → Telephony → Provision a Number (or connect a SIP trunk), and assign it to the agent. This is the studio's AI line.</li>
          <li>
            <b>Webhook</b>: Settings → Webhooks → add this URL:
            <div style={{ margin: '6px 0' }}><code>{base}/api/vaani/webhook?secret=&lt;VAANI_WEBHOOK_SECRET&gt;</code></div>
            {local && <div className="bad small">This is a local address. Vaani cannot reach it. Deploy to Vercel (or use a tunnel such as ngrok) and set <code>APP_URL</code> first.</div>}
          </li>
          <li><b>Test</b>: call the number, then check this page: the raw payload appears below and the call lands on the dashboard and in Telegram.</li>
        </ol>
        <p className="foot">
          Vaani sends <code>call_postprocessing</code> (transcript, summary, duration) after each call. That event runs triage, the log row, the Telegram handoff and the HubSpot deal.
          Vaani documents no webhook signature, so the secret travels in the URL.
        </p>
      </div>

      <h2 className="section">Last Vaani webhook payloads</h2>
      <p className="meta" style={{ margin: "0 0 10px" }}>The docs do not list every field. The first real call shows exactly what Vaani sends, and <code>lib/vaani.ts</code> is the only file to adjust.</p>
      <div className="card card-pad">
        {events.length === 0 && <span className="dim">Nothing received yet.</span>}
        {events.map((e, i) => (
          <details key={i} style={{ margin: '4px 0' }}>
            <summary>
              {when(e.at)} · <b>{e.event ?? 'unknown'}</b> · <span className={e.ok ? 'ok' : 'bad'}>{e.note}</span>
            </summary>
            <pre className="prompt">{JSON.stringify(e.payload, null, 2)}</pre>
          </details>
        ))}
      </div>

      <h2 className="section">Agent prompt for Vaani</h2>
      <p className="meta" style={{ margin: "0 0 10px" }}>Built from services.md, qualified.md and never-say.md. pricing.md's numbers are never included, so the agent cannot repeat them.</p>
      <pre className="prompt">{buildAgentPrompt('standalone')}</pre>
      </div>
    </>
  );
}
