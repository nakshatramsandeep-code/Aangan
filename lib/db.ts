import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { config } from './config';
import type { CallRow } from './types';

/**
 * One row per call. The whole call lives in a jsonb `data` column so the shape can grow
 * (new criteria, new integrations) without migrations. Without DATABASE_URL we fall back
 * to a local JSON file so the app is demo-able before Neon is connected.
 */

let ready: Promise<void> | null = null;
const sql = () => neon(config.databaseUrl);

function ensure() {
  if (!ready) {
    ready = sql()
      .query(
        `create table if not exists calls (
           id text primary key,
           created_at timestamptz not null,
           data jsonb not null
         )`,
      )
      .then(() => undefined)
      .catch((e) => {
        ready = null; // do not cache a failure: the next request retries
        throw e;
      });
  }
  return ready;
}

const FILE = path.join(process.cwd(), '.data', 'calls.json');
const readFile = (): CallRow[] => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
};
const writeFile = (rows: CallRow[]) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(rows, null, 1));
};

export async function getCall(id: string): Promise<CallRow | null> {
  if (!config.databaseUrl) return readFile().find((r) => r.id === id) ?? null;
  await ensure();
  const rows = await sql().query('select data from calls where id = $1', [id]);
  return (rows[0]?.data as CallRow) ?? null;
}

export async function saveCall(row: CallRow): Promise<void> {
  if (!config.databaseUrl) {
    const rows = readFile();
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    writeFile(rows);
    return;
  }
  await ensure();
  await sql().query(
    `insert into calls (id, created_at, data) values ($1, $2, $3)
     on conflict (id) do update set data = excluded.data`,
    [row.id, row.created_at, JSON.stringify(row)],
  );
}

export async function listCalls(limit = 500): Promise<CallRow[]> {
  if (!config.databaseUrl) {
    return readFile()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  await ensure();
  const rows = await sql().query('select data from calls order by created_at desc limit $1', [limit]);
  return rows.map((r) => r.data as CallRow);
}

export async function deleteSimulated(): Promise<number> {
  if (!config.databaseUrl) {
    const rows = readFile();
    const keep = rows.filter((r) => !r.simulated);
    writeFile(keep);
    return rows.length - keep.length;
  }
  await ensure();
  const res = await sql().query(`delete from calls where data->>'simulated' = 'true' returning id`);
  return res.length;
}

/* ---- Raw Vaani webhook payloads: the last 50, so the field mapping can be checked against real calls ---- */
export interface LoggedEvent { at: string; event?: string; ok: boolean; note?: string; payload: unknown }
const EVENTS = path.join(process.cwd(), '.data', 'vaani-events.json');

export async function logEvent(e: LoggedEvent): Promise<void> {
  if (!config.databaseUrl) {
    let rows: LoggedEvent[] = [];
    try { rows = JSON.parse(fs.readFileSync(EVENTS, 'utf8')); } catch {}
    rows.unshift(e);
    fs.mkdirSync(path.dirname(EVENTS), { recursive: true });
    fs.writeFileSync(EVENTS, JSON.stringify(rows.slice(0, 50), null, 1));
    return;
  }
  await sql().query(`create table if not exists vaani_events (id bigserial primary key, at timestamptz not null, data jsonb not null)`);
  await sql().query('insert into vaani_events (at, data) values ($1, $2)', [e.at, JSON.stringify(e)]);
  await sql().query('delete from vaani_events where id not in (select id from vaani_events order by id desc limit 50)');
}

export async function listEvents(limit = 10): Promise<LoggedEvent[]> {
  if (!config.databaseUrl) {
    try { return JSON.parse(fs.readFileSync(EVENTS, 'utf8')).slice(0, limit); } catch { return []; }
  }
  try {
    const rows = await sql().query('select data from vaani_events order by id desc limit $1', [limit]);
    return rows.map((r) => r.data as LoggedEvent);
  } catch { return []; }
}
