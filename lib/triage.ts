import { config } from './config';
import { knowledge, servedLocalities, OUT_OF_AREA } from './knowledge';
import type { Criteria, CriterionKey, Fields, RouteDecision, TriageResult } from './types';

export interface TriageInput {
  /** Answers collected so far, mid-call (key -> what the caller said). */
  answers?: Record<string, string>;
  /** Full transcript, at call end. Wins over answers when present. */
  transcript?: string;
  /** When the call happened. Timelines are judged against this date. Defaults to now. */
  asOf?: Date;
}

const ORDER: CriterionKey[] = ['real_project', 'service_area', 'timeline', 'budget', 'decision_maker'];

/* ------------------------------------------------------------------ */
/* Transcript helpers                                                  */
/* ------------------------------------------------------------------ */

const AGENT_LABEL = /^(front desk|agent|assistant|vaani|ai)\s*:/i;
const CALLER_LABEL = /^(caller|user|customer|lead)\s*:/i;

export function splitTranscript(t: string) {
  const agent: string[] = [];
  const caller: string[] = [];
  let side: 'agent' | 'caller' | null = null;
  for (const raw of t.split(/\r?\n/)) {
    // Vaani prefixes each line with a time, e.g. "[16:30:45] AGENT: ..."
    const line = raw.trim().replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '');
    if (!line) continue;
    if (AGENT_LABEL.test(line)) side = 'agent';
    else if (CALLER_LABEL.test(line)) side = 'caller';
    else if (/^note\s*:/i.test(line)) side = null;
    const text = line.replace(/^[A-Za-z ]+:\s*/, '');
    if (side === 'agent') agent.push(text);
    else if (side === 'caller') caller.push(text);
  }
  return { agent, caller, labelled: agent.length + caller.length > 0 };
}

function inputText(input: TriageInput) {
  if (input.transcript) return input.transcript;
  return Object.entries(input.answers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function callerText(input: TriageInput) {
  const split = input.transcript ? splitTranscript(input.transcript) : null;
  return split?.labelled ? split.caller.join(' ') : inputText(input);
}

/* ------------------------------------------------------------------ */
/* Gemini                                                              */
/* ------------------------------------------------------------------ */

const crit = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['pass', 'fail', 'unclear'] },
    note: { type: 'STRING' },
  },
  required: ['status', 'note'],
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fields: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        phone: { type: 'STRING' },
        project_type: { type: 'STRING', enum: ['residential', 'commercial', 'other'] },
        locality: { type: 'STRING' },
        area_sqft: { type: 'NUMBER' },
        scope: { type: 'STRING' },
        completion_date: { type: 'STRING' },
        decision_maker: { type: 'STRING' },
        budget_mentioned: { type: 'STRING' },
        email: { type: 'STRING' },
        preferred_time: { type: 'STRING' },
        preferred_start: { type: 'STRING' },
      },
    },
    criteria: {
      type: 'OBJECT',
      properties: Object.fromEntries(ORDER.map((k) => [k, crit])),
      required: ORDER,
    },
    complaint: { type: 'BOOLEAN' },
    summary: { type: 'STRING' },
  },
  required: ['fields', 'criteria', 'complaint', 'summary'],
};

function systemPrompt(asOf: Date = new Date()) {
  const today = asOf.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'full' });
  return `You are the triage step for Aangan Studio, an interior design studio in Pune. You read what a caller said and judge it against the studio's rubric. You do not talk to the caller, you do not decide what happens next, and you never invent facts the caller did not say.

Today is ${today} (IST). Use it to judge timelines.

Return, for each of the five criteria, status "pass", "fail" or "unclear" and a short note quoting or paraphrasing the evidence:
- real_project, service_area, timeline: "unclear" if the caller has not said enough. "fail" only on clear evidence.
- timeline fails ONLY when the caller needs the project ready in under 6 weeks from the call. The typical design and execution durations in services.md are for the designer to weigh at the consultation; they are NOT a reason to fail a caller. A caller who needs it in 6 weeks or more (for example "two months") passes. If the deadline is between 6 and 12 weeks away, still pass it, but begin the note with "Tight:" and say what they need, so the designer sees it.
- timeline: a move-in date, an operational date or a "done by" month all count as a stated timeline ("pass" if workable). A start date or "no rush" also passes. When the deadline is relative or tied to an event ("before Diwali", "in 3 weeks", "by the wedding"), work out the actual date from today's date and compare it with the studio's minimum lead time in services.md (execution cannot begin on a project that must be ready in under 6 weeks). If it is under that, status is "fail"; do not leave it "unclear" just because no calendar date was said.
- budget: ONLY judge a number the caller volunteered. If no budget was mentioned, status is "pass" with note "Not mentioned, treated as qualified". "fail" only if a volunteered number is clearly below what any project of the described scope would cost (the owner's floor for any real project is about ${config.rules.budgetFloorLakh} lakh). Never use "unclear" for a missing budget.
- decision_maker: "pass" if the caller is the decider or is authorised by them, or if it was simply not discussed. "unclear" if the caller is only researching on behalf of someone else without confirmed authority.
Set complaint=true if the caller is complaining about an existing project, says someone promised to get back to them and did not, says an earlier message or enquiry was ignored or lost, or is clearly upset or frustrated with the studio. When in doubt, complaint=true: a human should hear about it.
Extract fields only from the caller's own words (if the caller spells their name letter by letter, use that spelling), as short plain values with no commentary: scope is the rooms or work in at most 12 words (for example "kitchen, wardrobes, living room"); completion_date is a few words ("by March 2027"); decision_maker is a few words ("caller and spouse"); locality is just the area name. Leave a field out if the caller did not say it. email: the caller's email address as written, lower case. Callers spell it aloud ("meera dot iyer at gmail dot com" means meera.iyer@gmail.com); convert it, and leave it out unless it is clearly a full address. preferred_time: the day and time the caller asked for, in a few words ("Tuesday afternoon"). preferred_start: ONLY if the caller named a specific day AND a time of day, that moment as an ISO 8601 timestamp with the +05:30 offset, resolved from today's date (for "Tuesday at 3pm" use the next Tuesday 15:00:00+05:30); otherwise leave it out. summary: two plain sentences a designer can read in five seconds.

=== services.md ===
${knowledge.services()}

=== qualified.md (the rubric, written by the founder) ===
${knowledge.qualified()}`;
}

/** Spoken or written, to a plain address; undefined when it is not clearly one. */
export function cleanEmail(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase().trim().replace(/\s+at\s+/g, '@').replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(t) && t.length <= 100 ? t : undefined;
}


const WEEKDAYS: [RegExp, number][] = [
  [/\b(sun(day)?)\b/, 0], [/\b(mon(day)?)\b/, 1], [/\b(tue(s|sday)?)\b/, 2], [/\b(wed(nesday)?)\b/, 3],
  [/\b(thu(r|rs|rsday)?)\b/, 4], [/\b(fri(day)?)\b/, 5], [/\b(sat(urday)?)\b/, 6],
];

/**
 * "Thursday at 3 pm", "tomorrow morning", "Monday 11" -> the next such moment after `asOf`, in IST.
 * Needs both a day and a time of day; otherwise null. Gemini does this too; this keeps it deterministic
 * when Gemini leaves it out. The scheduler still checks office hours and the calendar.
 */
export function parsePreferred(text: string, asOf: Date): { preferred_time: string; preferred_start?: string } | null {
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  const IST = 5.5 * 3600e3;
  const today = new Date(asOf.getTime() + IST);
  let offset: number | null = null;
  let dayWord = '';
  if (/\btomorrow\b/.test(t)) { offset = 1; dayWord = 'tomorrow'; }
  else for (const [re, wd] of WEEKDAYS) {
    const m = t.match(re);
    if (m) { offset = ((wd - today.getUTCDay() + 7) % 7) || 7; dayWord = m[0]; break; }
  }
  if (offset === null) return null;

  let hour: number | null = null, minute = 0, timeWord = '';
  const clock = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/);
  const bare = t.match(/\b(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?(?!\s*(?:sq|bhk|lakh|k\b|\d))/);
  if (clock) {
    hour = Number(clock[1]) % 12 + (clock[3].startsWith('p') ? 12 : 0); minute = Number(clock[2] ?? 0); timeWord = clock[0];
  } else if (bare) {
    const h = Number(bare[1]); hour = h >= 1 && h <= 6 ? h + 12 : h; minute = Number(bare[2] ?? 0); timeWord = bare[0];
  } else if (/\bnoon\b/.test(t)) { hour = 12; timeWord = 'noon'; }
  else if (/\bafternoon\b/.test(t)) { hour = 15; timeWord = 'afternoon'; }
  else if (/\bmorning\b/.test(t)) { hour = 11; timeWord = 'morning'; }
  else if (/\bevening\b/.test(t)) { timeWord = 'evening'; }
  if (!timeWord) return null;

  const label = `${dayWord} ${timeWord}`.replace(/\s+/g, ' ').trim();
  if (hour === null || hour > 23 || minute > 59) return { preferred_time: label };
  const y = today.getUTCFullYear(), mo = today.getUTCMonth(), d = today.getUTCDate() + offset;
  return { preferred_time: label, preferred_start: new Date(Date.UTC(y, mo, d, hour, minute) - IST).toISOString() };
}

/** Gemini's free-text fields sometimes ramble. Designers read these in a Telegram note, so cap them in code. */
function tidyFields(f: Fields): Fields {
  const cap = (v: string | undefined, max: number) => {
    if (!v) return v;
    const t = v.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'), cut.lastIndexOf('.'));
    return (at > max * 0.4 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))).trim();
  };
  return {
    ...f,
    name: cap(f.name, 40),
    locality: cap(f.locality, 30),
    scope: cap(f.scope, 90),
    completion_date: cap(f.completion_date, 40),
    decision_maker: cap(f.decision_maker, 40),
    budget_mentioned: cap(f.budget_mentioned, 40),
    email: cleanEmail(f.email),
    preferred_time: cap(f.preferred_time, 60),
    preferred_start: f.preferred_start && !isNaN(Date.parse(f.preferred_start)) ? new Date(f.preferred_start).toISOString() : undefined,
  };
}

async function gemini(input: TriageInput, timeoutMs: number): Promise<TriageResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(input.asOf) }] },
      contents: [{ role: 'user', parts: [{ text: `What the caller said:\n\n${inputText(input)}` }] }],
      generationConfig: {
        temperature: 0,
        ...(config.gemini.thinking ? { thinkingConfig: { thinkingLevel: config.gemini.thinking } } : {}),
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  const out = JSON.parse(text);
  return {
    fields: tidyFields(out.fields ?? {}),
    criteria: out.criteria,
    complaint: !!out.complaint || COMPLAINT_RE.test(callerText(input).replace(/[’‘]/g, "'").toLowerCase()),
    summary: out.summary ?? '',
    engine: 'gemini',
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Rule-based fallback (no API key, or Gemini failed)                  */
/* ------------------------------------------------------------------ */

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()]);
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

/** Deliberately broad: a missed complaint costs far more than an unneeded escalation. */
const COMPLAINT_RE =
  /not acceptable|hasn't replied|haven't replied|no one replied|no follow.?up|frustrated|complain|didn't get back|get back to me|not a good sign|forgot|no reply/;

function heuristic(input: TriageInput): TriageResult {
  const all = inputText(input);
  const split = input.transcript ? splitTranscript(input.transcript) : null;
  const text = (split?.labelled ? split.caller.join(' ') : all).replace(/[’‘]/g, "'");
  const lower = text.toLowerCase();

  const fields: Fields = {};
  fields.name = text.match(/\b(?:[Ii]'m|[Ii] am|[Mm]y name is|[Tt]his is)\s+([A-Z][\w-]*(?:\s[A-Z][\w-]*)?)(?=[\s,.])/)?.[1];
  const area = text.match(/([\d,]{3,6})\s*(?:sq\.?\s*ft|sqft|square feet)/i)?.[1];
  if (area) fields.area_sqft = Number(area.replace(/,/g, ''));
  fields.project_type = /restaurant|hotel|cafe|retail|showroom|gym/.test(lower)
    ? 'other'
    : /office|startup|clinic|studio space|coworking|commercial|workstation/.test(lower)
      ? 'commercial'
      : 'residential';
  const scopeWords = ['kitchen', 'wardrobe', 'living room', 'bedroom', 'dining', 'study', 'home office', 'flooring', 'whole', 'full home', 'complete redesign', 'workstation', 'cabin', 'meeting room'];
  fields.scope = scopeWords.filter((w) => lower.includes(w)).join(', ') || undefined;
  fields.email = cleanEmail(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/)?.[0] ?? lower.match(/\b([a-z0-9]+(?: dot [a-z0-9]+)*) at ([a-z0-9]+(?: dot [a-z0-9]+)* dot (?:com|in|org|net|co|io|co dot in))\b/)?.[0]);
  Object.assign(fields, parsePreferred(text, input.asOf ?? new Date()) ?? {});
  fields.budget_mentioned = text.match(/(?:₹|rs\.?\s?)?\d+(?:\.\d+)?\s*(?:to|-|–)?\s*(?:\d+(?:\.\d+)?)?\s*lakhs?[^.]*/i)?.[0]?.trim();

  /* 1 real project */
  let real: Criteria['real_project'];
  if (/restaurant|hotel|\bgym\b|retail|showroom/.test(lower))
    real = { status: 'fail', note: 'Hospitality / retail / gym is out of scope per services.md' };
  else if (/(ideas|suggestions|advice|advise|second opinion|colours?).{0,80}(just|only)|(just|only).{0,40}(ideas|suggestions|advice|advise|exploring)|myself.{0,20}execution|execution myself|just exploring/.test(lower))
    real = { status: 'fail', note: 'Wants advice or ideas, not design with execution' };
  else if (/redo|redesign|design|interior|fit ?out|whole|full|kitchen|wardrobe|living room|bedroom|villa|flat|apartment|office|renovat|remodel|revamp|makeover|furnish|\bbhk\b|\b\d\s*bhk\b/.test(lower))
    real = { status: 'pass', note: fields.scope ? `Wants design with execution: ${fields.scope}` : 'Wants a design project' };
  else real = { status: 'unclear', note: 'Not yet clear whether this is a full design and execution project' };

  /* 2 service area */
  const out = OUT_OF_AREA.find((p) => lower.includes(p));
  const served = servedLocalities().find((p) => lower.includes(p));
  let area_: Criteria['service_area'];
  if (out) area_ = { status: 'fail', note: `${out[0].toUpperCase() + out.slice(1)} is outside Pune and PCMC` };
  else if (served || /\bpune\b|pcmc|pimpri|chinchwad|kharadi|nanded/.test(lower)) {
    fields.locality = served ? served.replace(/(^|\s)\w/g, (ch) => ch.toUpperCase()) : 'Pune';
    area_ = { status: 'pass', note: `In service area (${fields.locality})` };
  } else area_ = { status: 'unclear', note: 'Locality not stated' };

  /* 3 timeline */
  let timeline: Criteria['timeline'];
  const tight =
    lower.match(/(?:ready|done|finish\w*|complete\w*|operational|presentable|need\w*)[^.]{0,60}?\b(\d+|one|two|three|four|five)\s*weeks?\b/) ??
    lower.match(/\b(\d+|one|two|three|four|five)\s*weeks?\b[^.]{0,20}(?:max|only|at most)/);
  if (tight && (num(tight[1]) ?? 99) < 6) {
    fields.completion_date = tight[0];
    timeline = { status: 'fail', note: `Needs it done in about ${tight[1]} weeks; studio needs at least 6 weeks lead time` };
  } else if (/before diwali|before the festival|next week|in a week/.test(lower)) {
    fields.completion_date = 'before Diwali';
    timeline = { status: 'fail', note: 'Wants it finished before Diwali, too soon for design plus execution' };
  } else if (new RegExp(`\\b(${MONTHS})\\b|no rush|flexible|plenty of time|right away|start now|immediately|as soon as|\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s*months?\\b`).test(lower)) {
    fields.completion_date = lower.match(new RegExp(`(?:by|in|before|starting|start)\\s+(?:${MONTHS})(?:\\s+\\d{4})?|no rush|flexible|(\\d+)\\s*months?`))?.[0] ?? 'stated';
    timeline = { status: 'pass', note: `Workable timeline: ${fields.completion_date}` };
  } else timeline = { status: 'unclear', note: 'Completion date not stated' };

  /* 4 budget: only what was volunteered */
  let budget: Criteria['budget'] = { status: 'pass', note: 'Not mentioned, treated as qualified' };
  const lakh = [...lower.matchAll(/(\d+(?:\.\d+)?)(?:\s*(?:to|-|–)\s*(\d+(?:\.\d+)?))?\s*lakhs?/g)][0];
  if (lakh) {
    const top = Number(lakh[2] ?? lakh[1]);
    budget =
      top < config.rules.budgetFloorLakh
        ? { status: 'fail', note: `Volunteered budget (${lakh[0]}) is clearly below any project of this scope` }
        : { status: 'pass', note: `Volunteered budget: ${lakh[0]}` };
  }

  /* 5 decision maker */
  let dm: Criteria['decision_maker'];
  if (/for my (parents|in-laws|father|mother|mom|dad|boss)|initial (checking|research)|just (doing )?(initial )?research|on behalf/.test(lower) && !/authori[sz]ed|they('ve| have) asked me to go ahead/.test(lower)) {
    fields.decision_maker = 'Caller is checking on behalf of someone else';
    dm = { status: 'unclear', note: 'Caller is researching for family; owners decide' };
  } else {
    fields.decision_maker = /my husband|my wife|owner|founder|myself/.test(lower) ? 'Caller (with spouse)' : 'Caller';
    dm = { status: 'pass', note: 'Caller is the decider or authorised' };
  }

  const complaint = COMPLAINT_RE.test(lower);

  return {
    fields,
    criteria: { real_project: real, service_area: area_, timeline, budget, decision_maker: dm },
    complaint,
    summary: [
      fields.name ? `${fields.name}` : 'Caller',
      `enquires about ${fields.project_type} work${fields.locality ? ` in ${fields.locality}` : ''}${fields.area_sqft ? ` (~${fields.area_sqft} sq ft)` : ''}.`,
      fields.scope ? `Scope: ${fields.scope}.` : '',
    ].join(' '),
    engine: 'heuristic',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function triage(input: TriageInput): Promise<TriageResult> {
  if (config.gemini.key) {
    // Gemini's latency has a long tail (usually ~8 s, sometimes 40 s+). A slow request is usually a stuck
    // one, so a second attempt beats one very long wait. Triage runs after the webhook has already answered Vaani, so there is room for 2 x 45 s.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const g = await gemini(input, 45_000);
        // Gemini sometimes omits facts the caller plainly stated. Fill gaps from the rule-based reading.
        const h = heuristic(input).fields;
        for (const k of ['name', 'locality', 'area_sqft', 'project_type', 'email', 'preferred_time', 'preferred_start'] as const) {
          if (g.fields[k] == null || g.fields[k] === '') (g.fields as Record<string, unknown>)[k] = h[k];
        }
        return g;
      } catch (e) {
        const status = (e as { status?: number }).status;
        console.error(`[triage] Gemini attempt ${attempt} failed:`, (e as Error).message);
        if (status && status < 500) break; // 4xx (bad key, quota, bad model): retrying will not help
      }
    }
  }
  return heuristic(input);
}

const QUESTIONS: Partial<Record<CriterionKey, string>> = {
  real_project: 'Are you looking for a full design with execution, or mainly advice and ideas?',
  service_area: 'Which area or locality is the property in?',
  timeline: 'When would you need the project to be complete?',
};

/**
 * The route is decided here, in plain code, not by the model. Gemini judges each criterion;
 * this function applies the rubric's boundary rules (qualified.md "At the boundary") so the
 * behaviour is testable and Nikhil can read exactly why a call went where it did.
 */
export function decideRoute(t: TriageResult): RouteDecision {
  const c = t.criteria;

  if (t.complaint) {
    return {
      route: 'escalate',
      flags: ['Complaint or upset caller. Needs a senior person.'],
      say: 'I am very sorry about that experience. I am flagging this to a senior person right now so that they call you back. Can I confirm your name and the best number to reach you?',
    };
  }

  const failed = ORDER.filter((k) => c[k].status === 'fail');
  if (failed.length) {
    const first = failed[0];
    const reason: Record<CriterionKey, string> = {
      real_project: 'Our minimum engagement is a room redesign with full execution, so we are not the right fit for advice or ideas on their own.',
      service_area: 'We only work in Pune city and PCMC because our execution depends on our own vendor network.',
      timeline: 'Design takes a few weeks and execution follows, so we could not do justice to a project needed that soon.',
      budget: 'A project of that scope would cost significantly more than that, and I would not want to bring you to a consultation where the numbers do not align.',
      decision_maker: 'We would need the person who decides to be part of the conversation.',
    };
    return {
      route: 'close_gracefully',
      flags: failed.map((k) => `${k.replace('_', ' ')}: ${c[k].note}`),
      say: `${reason[first]} This sounds like it may not be the right fit for us right now, but please feel free to reach out if your timeline or scope changes.`,
    };
  }

  // Unclear on 1-3: ask one direct question, the earliest unclear one.
  const ask = (['real_project', 'service_area', 'timeline'] as CriterionKey[]).find((k) => c[k].status === 'unclear');
  if (ask) {
    return {
      route: 'ask_question',
      asking_for: ask,
      next_question: QUESTIONS[ask],
      flags: [],
      say: QUESTIONS[ask]!,
    };
  }

  // Unclear on 4 or 5: do not push. Treat as qualified and tell the designer.
  const flags = (['budget', 'decision_maker'] as CriterionKey[])
    .filter((k) => c[k].status === 'unclear')
    .map((k) => `${k.replace('_', ' ')}: ${c[k].note}`);
  if (c.timeline.status === 'pass' && /^tight/i.test(c.timeline.note)) flags.push(`timeline: ${c.timeline.note}`);
  const bookSay =
    'Tell the caller a designer will call them to arrange the free consultation. Do not promise a date or time. If they ask about price, use the fixed pricing line and do not give a number.';
  return { route: flags.length ? 'qualified_flag' : 'qualified', flags, say: bookSay };
}
