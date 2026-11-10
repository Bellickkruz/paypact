// Turns "Bill Sarah $300 for the logo design by Friday, half upfront" into invoice fields.
// Rule-based, runs in the browser, and never touches money.

export interface ParsedInvoice {
  client?: string;
  amount?: string;
  title?: string;
  dueInDays?: number;
  upfrontPercent?: number;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function daysUntil(target: Date, now: Date): number {
  const ms = target.setHours(23, 59, 0, 0) - now.getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

function parseDue(text: string, now: Date): number | undefined {
  const t = text.toLowerCase();
  let m = t.match(/\bin (\d{1,3}) ?(day|days|week|weeks)\b/);
  if (m) return Number(m[1]) * (m[2].startsWith("week") ? 7 : 1);
  if (/\btomorrow\b/.test(t)) return 1;
  if (/\b(today|tonight|asap)\b/.test(t)) return 1;
  if (/\bnext week\b/.test(t)) return 7;
  if (/\b(end of (the )?month|month end)\b/.test(t)) {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return daysUntil(end, now);
  }
  m = t.match(/\b(?:by|on|before|due)?\s*(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const target = DAYS.indexOf(m[1]);
    let diff = (target - now.getDay() + 7) % 7 || 7;
    if (/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.test(t) && diff < 7) diff += 7;
    return diff;
  }
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/) ??
    t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) {
    const [day, mon] = /\d/.test(m[1]) ? [Number(m[1]), m[2]] : [Number(m[2]), m[1]];
    const target = new Date(now.getFullYear(), MONTHS.indexOf(mon.slice(0, 3)), day);
    if (target < now) target.setFullYear(target.getFullYear() + 1);
    return daysUntil(target, now);
  }
  return undefined;
}

export function parseInvoice(text: string, now = new Date()): ParsedInvoice {
  const out: ParsedInvoice = {};
  const amount = text.match(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?/i) ??
    text.match(/(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\s*(?:usd|usdc|usdt|dollars?|bucks)\b/i);
  if (amount) {
    const n = Number(amount[1].replace(/,/g, "")) * (amount[2] ? 1000 : 1);
    if (n > 0) out.amount = String(n);
  }
  const client = text.match(/\b(?:bill|invoice|charge|send (?:an )?invoice to|request (?:payment )?from)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)/i);
  if (client && !/^(for|the|my|a|an)$/i.test(client[1])) out.client = client[1].replace(/\b\w/g, (c) => c.toUpperCase());

  const title = text.match(/\bfor\s+(?:the\s+|a\s+|an\s+|my\s+)?(.+?)(?=\s+(?:by|before|due|on|in \d|next|tomorrow|today|,|\.|with|half|\d{1,3}\s?%)|[,.]|$)/i);
  if (title) {
    const t = title[1].trim();
    if (t && !/^\$?\d/.test(t)) out.title = t.charAt(0).toUpperCase() + t.slice(1);
  }
  out.dueInDays = parseDue(text, now);

  const pct = text.match(/(\d{1,3})\s?%\s*(?:up ?front|deposit|now|in advance)/i);
  if (pct) out.upfrontPercent = Math.min(100, Number(pct[1]));
  else if (/\bhalf\s+(?:up ?front|now|in advance|deposit)/i.test(text)) out.upfrontPercent = 50;
  else if (/\b(?:full|all|everything)\s+(?:up ?front|in advance)/i.test(text)) out.upfrontPercent = 100;
  return out;
}
