export type CriterionKey = 'real_project' | 'service_area' | 'timeline' | 'budget' | 'decision_maker';
export type CriterionStatus = 'pass' | 'fail' | 'unclear';
export interface Criterion {
  status: CriterionStatus;
  note: string;
}
export type Criteria = Record<CriterionKey, Criterion>;

export interface Fields {
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
  alert?: { sent: boolean; mock: boolean; at?: string; error?: string };
  hubspot?: { contact_id?: string; deal_id?: string; mock: boolean; error?: string };
  voice_minutes?: number;
  voice_cost_inr?: number;
  ai_cost_inr?: number;
  ai_tokens?: { input: number; output: number };
  simulated?: boolean;
}
