import fs from 'node:fs';
import path from 'node:path';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), 'knowledge', f), 'utf8');

// pricing.md is intentionally never loaded: the agent gets only never-say.md (rules, no numbers).
export const knowledge = {
  services: () => read('services.md'),
  qualified: () => read('qualified.md'),
  neverSay: () => read('never-say.md'),
};

/** Localities from the "Service area" section of services.md, lower-cased. */
export function servedLocalities(): string[] {
  const md = knowledge.services();
  const sec = md.split('## Service area')[1]?.split('##')[0] ?? '';
  const inParens = [...sec.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(',');
  const pcmc = sec.match(/PCMC \(([^)]*)\)/)?.[1] ?? '';
  return [...inParens.split(','), ...pcmc.split(',')]
    .map((s) => s.replace(/including|and adjoining areas|and/gi, '').trim().toLowerCase())
    .filter((s) => s.length > 2);
}

/** Places services.md says we do not serve, plus a few obvious others. */
export const OUT_OF_AREA = [
  'talegaon', 'lonavala', 'nashik', 'mumbai', 'thane', 'navi mumbai', 'nagpur', 'kolhapur',
  'satara', 'ahmednagar', 'bangalore', 'bengaluru', 'hyderabad', 'delhi', 'chennai', 'goa',
];
