export type CriterionKey = 'real_project' | 'service_area' | 'timeline' | 'budget' | 'decision_maker';
export type CriterionStatus = 'pass' | 'fail' | 'unclear';
export interface Criterion {
  status: CriterionStatus;
  note: string;
}
export type Criteria = Record<CriterionKey, Criterion>;

export interface Fields {
  email?: string;
  /** What the caller said, e.g. "Tuesday afternoon". */
  preferred_time?: string;
  /** The same, resolved to an ISO 8601 instant (IST), when the caller named a day and a time. */
  preferred_start?: string;
  name?: string;
  phone?: string;
  project_type?: string; // residential | commercial | other
  locality?: string;
  area_sqft?: number;
  scope?: string;
  completion_date?: string;
  decision_maker?: string;
  budget_mentioned?: string;
}

export interface TriageResult {
  fields: Fields;
  criteria: Criteria;
  complaint: boolean;
  summary: string;
  engine: 'gemini' | 'heuristic';
  usage: { inputTokens: number; outputTokens: number };
}

export type Route = 'qualified' | 'qualified_flag' | 'ask_question' | 'close_gracefully' | 'escalate';

export interface RouteDecision {
  route: Route;
  /** Set when route = ask_question: the single next thing the agent should ask. */
  next_question?: string;
  /** Set when route = ask_question: which criterion the question is for. */
  asking_for?: CriterionKey;
  /** Uncertainty the designer should see (criteria 4/5 unclear, etc). */
  flags: string[];
  /** What the agent should say or do next, for Vaani to speak. Never contains a price. */
  say: string;
}

export interface BookingInfo {
  provider: string; // set by whichever calendar tool is added later
  booking_id: string;
  start: string; // ISO
  attendee_name?: string;
  booked_at: string;
}

export interface Consultation {
  start?: string; // ISO
  end?: string;
  /** Whether the caller's own preference was used or the next free slot. */
  source?: 'preferred' | 'next_free';
  calendar: 'google' | 'mock' | 'none';
  event_id?: string;
  link?: string;
  /** Why no hold exists (calendar not connected, no free slot). */
  skipped?: string;
  error?: string;
}

export interface EmailResult {
  sent: boolean;
  mock: boolean;
  to?: string;
  id?: string;
  at?: string;
  /** Not an error: there was nobody to email (the caller gave no address). */
  skipped?: string;
  error?: string;
}

export interface CallRow {
  id: string; // Vaani call id
  created_at: string; // ISO
  status: 'in_progress' | 'ended';
  caller_number?: string;
  after_hours: boolean;
  answered_in_sec?: number;
  duration_sec?: number;
  transcript?: string;
  answers?: Record<string, string>;
  fields?: Fields;
  criteria?: Criteria;
  complaint?: boolean;
  summary?: string;
  route?: Route;
  flags: string[];
  next_question?: string;
  engine?: 'gemini' | 'heuristic';
  price_leak?: string[]; // agent phrases that look like a price
  booking?: BookingInfo;
  /** The tentative hold for the designer's consultation call. */
  consultation?: Consultation;
  email?: EmailResult;
  alert?: { sent: boolean; mock: boolean; at?: string; error?: string };
  hubspot?: { contact_id?: string; deal_id?: string; meeting_id?: string; mock: boolean; error?: string };
  voice_minutes?: number;
  voice_cost_inr?: number;
  ai_cost_inr?: number;
  ai_tokens?: { input: number; output: number };
  /** The caller never spoke (silent line, dropped call, browser test). Logged and costed, but not triaged or counted. */
  silent?: boolean;
  /** Set while a webhook is being processed, so a retry that arrives meanwhile does not do the work twice. */
  processing_since?: string;
  simulated?: boolean;
}
