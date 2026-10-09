const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

export const config = {
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || '',
  webhookSecret: process.env.VAANI_WEBHOOK_SECRET || '',
  gemini: {
    key: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },
  cal: {
    key: process.env.CAL_API_KEY || '',
    eventTypeId: process.env.CAL_EVENT_TYPE_ID || '',
    timezone: process.env.CAL_TIMEZONE || 'Asia/Kolkata',
    /** A real studio inbox. Callers without an email are booked as local+<phone>@domain so Cal.com accepts them. */
    fallbackEmail: process.env.CAL_FALLBACK_EMAIL || '',
  },
  hubspot: {
    token: process.env.HUBSPOT_TOKEN || '',
    dealStage: process.env.HUBSPOT_DEAL_STAGE || 'appointmentscheduled',
    pipeline: process.env.HUBSPOT_PIPELINE || 'default',
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  rules: {
    budgetFloorLakh: num(process.env.BUDGET_FLOOR_LAKH, 3),
    openHour: num(process.env.OPEN_HOUR, 10),
    closeHour: num(process.env.CLOSE_HOUR, 19),
  },
  cost: {
    vaaniPerMinInr: num(process.env.VAANI_COST_PER_MIN_INR, 6),
    geminiInUsdPerM: num(process.env.GEMINI_INPUT_USD_PER_M, 0.3),
    geminiOutUsdPerM: num(process.env.GEMINI_OUTPUT_USD_PER_M, 2.5),
    usdInr: num(process.env.USD_INR, 88),
    fixedMonthlyInr: num(process.env.FIXED_MONTHLY_COST_INR, 0),
  },
  /** Average project value from the brief (₹ lakh). Used for pipeline value only, never as revenue. */
  projectValueLakh: { low: 8, high: 14 },
};

export const integrationStatus = () => ({
  neon: !!config.databaseUrl,
  gemini: !!config.gemini.key,
  calcom: !!(config.cal.key && config.cal.eventTypeId),
  hubspot: !!config.hubspot.token,
  telegram: !!(config.telegram.token && config.telegram.chatId),
  vaaniSecret: !!config.webhookSecret,
});
