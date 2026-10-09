/** The simulator pushes fake calls through the real pipeline (Telegram, HubSpot, Gemini), so it only runs locally. */
export const simulatorEnabled = !process.env.VERCEL;
