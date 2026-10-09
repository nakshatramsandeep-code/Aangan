import { config } from './config';

export function voiceCostInr(durationSec: number) {
  const minutes = Math.ceil(durationSec / 60); // telephony is billed per started minute
  return { minutes, inr: minutes * config.cost.vaaniPerMinInr };
}

export function aiCostInr(inputTokens: number, outputTokens: number) {
  const usd =
    (inputTokens / 1e6) * config.cost.geminiInUsdPerM + (outputTokens / 1e6) * config.cost.geminiOutUsdPerM;
  return usd * config.cost.usdInr;
}
