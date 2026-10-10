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
    /** Optional thinking level ('low'). Left empty: 'low' was faster on trivial prompts but misjudged 2 of the 19 real calls. */
    thinking: process.env.GEMINI_THINKING ?? '',
  },
  hubspot: {
    token: process.env.HUBSPOT_TOKEN || '',
    dealStage: process.env.HUBSPOT_DEAL_STAGE || 'appointmentscheduled',
    pipeline: process.env.HUBSPOT_PIPELINE || 'default',
  },
  google: {
    /** Service-account JSON (raw or base64). The designer's calendar must be shared with its email. */
    serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    calendarId: process.env.GOOGLE_CALENDAR_ID || '',
    /** OAuth alternative to the service account: works where the organization blocks service-account keys. */
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    oauthRefreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
  },
  consult: {
    minutes: num(process.env.CONSULT_MINUTES, 60),
    /** Earliest a hold may start, counted from the call. Gives the designer time to react. */
    leadHours: num(process.env.CONSULT_LEAD_HOURS, 18),
  },
  resend: {
    key: process.env.RESEND_API_KEY || '',
    /** Must be on a domain verified in Resend. onboarding@resend.dev only delivers to the account owner. */
    from: process.env.RESEND_FROM || 'Aangan Studio <onboarding@resend.dev>',
    replyTo: process.env.RESEND_REPLY_TO || '',
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
  hubspot: !!config.hubspot.token,
  calendar: !!((config.google.serviceAccount && config.google.calendarId) || (config.google.oauthClientId && config.google.oauthClientSecret && config.google.oauthRefreshToken)),
  email: !!config.resend.key,
  telegram: !!(config.telegram.token && config.telegram.chatId),
  vaaniSecret: !!config.webhookSecret,
});
