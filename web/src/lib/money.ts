import { config } from "./config";

const SCALE = 10n ** BigInt(config.decimals);

/** "300.5" -> "300500000" (smallest units), or null if it isn't a valid positive amount. */
export function toUnits(input: string): string | null {
  const s = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const units = BigInt(whole) * SCALE + BigInt(frac.padEnd(config.decimals, "0"));
  return units > 0n ? units.toString() : null;
}

/** "300500000" -> "$300.50" */
export function formatUsd(units: string | bigint, opts: { cents?: boolean } = {}): string {
  const u = BigInt(units);
  const whole = u / SCALE;
  const cents = (u % SCALE) / 10n ** BigInt(config.decimals - 2);
  const w = whole.toLocaleString("en-US");
  if (cents === 0n && !opts.cents) return `$${w}`;
  return `$${w}.${cents.toString().padStart(2, "0")}`;
}

export const nsToDate = (ns: string | number | bigint) => new Date(Number(BigInt(ns) / 1_000_000n));
