/**
 * Safety net for the never-say list. The agent never sees pricing numbers, but we still scan
 * what the agent actually said on every call, so a prompt regression shows up on the dashboard
 * instead of in a customer's head.
 */
const PRICE_PATTERNS: RegExp[] = [
  /₹\s?\d/,
  /\brs\.?\s?\d/i,
  /\binr\b/i,
  /\b\d+(\.\d+)?\s*(lakhs?|lacs?|crores?)\b/i,
  /\bper\s*(sq\.?\s*ft|square f)/i,
  /\b(it'?ll|it will|would)\s+cost\s+(around|about|roughly)/i,
  /\brates?\s+(start|begin)/i,
  /\btypically\s+(₹|rs\.?\s?\d|\d+(\.\d+)?\s*(lakhs?|lacs?|k\b))/i,
];

export function detectPriceLeak(agentLines: string[]): string[] {
  return agentLines.filter((l) => PRICE_PATTERNS.some((p) => p.test(l))).map((l) => l.slice(0, 200));
}
