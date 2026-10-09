'use client';
import Link from 'next/link';
import { useState } from 'react';

interface Fixture { id: string; date: string; time: string; transcript: string; expected?: string }

export default function Simulator({ fixtures }: { fixtures: Fixture[] }) {
  const usable = fixtures.filter((f) => f.expected);
  const [text, setText] = useState(usable[0]?.transcript ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; route: string } | null>(null);
  const [error, setError] = useState('');

  async function run(transcript: string) {
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript }) });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e) { setError(String((e as Error).message)); }
    setBusy(false);
  }

  async function runAll() {
    setBusy(true); setError(''); setResult(null);
    for (const f of usable) {
      await fetch('/api/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: f.transcript }) });
    }
    setBusy(false);
    window.location.href = '/';
  }

  async function clear() {
    await fetch('/api/simulate', { method: 'DELETE' });
    setResult(null);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <select onChange={(e) => setText(usable.find((f) => f.id === e.target.value)?.transcript ?? '')} defaultValue={usable[0]?.id}>
          {usable.map((f) => <option key={f.id} value={f.id}>{f.id} · {f.date} {f.time} · expected {f.expected}</option>)}
        </select>
        <button disabled={busy || !text.trim()} onClick={() => run(text)}>{busy ? 'Running…' : 'Run this call'}</button>
        <button className="ghost" disabled={busy} onClick={runAll}>Run all {usable.length}</button>
        <button className="ghost" disabled={busy} onClick={clear}>Delete simulated calls</button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {result && <p>Routed <b>{result.route}</b>. <Link href={`/calls/${encodeURIComponent(result.id)}`}>Open the call</Link></p>}
      {error && <p className="bad">{error}</p>}
    </div>
  );
}
