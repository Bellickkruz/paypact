// Live numbers for the home page, read straight from the PayPact contract (no backend):
// how much is locked in escrow right now, how much has been paid out, and recent activity.
import { getInvoice, heldAmount, type Invoice } from "./near";

/** The highest invoice id: invoice ids are consecutive, so find the last one in ~log2(n) reads. */
async function lastId(): Promise<number> {
  let hi = 1;
  while (await getInvoice(String(hi))) hi *= 2;
  let lo = Math.floor(hi / 2); // exists (or 0)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await getInvoice(String(mid))) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface NetworkStats {
  invoices: number;
  lockedNow: bigint;
  paidOut: bigint;
  recent: Invoice[];
}

export async function networkStats(maxScan = 150): Promise<NetworkStats> {
  const last = await lastId();
  const first = Math.max(1, last - maxScan + 1);
  const ids = Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
  const all: Invoice[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = await Promise.all(ids.slice(i, i + 25).map((id) => getInvoice(id).catch(() => null)));
    all.push(...batch.filter((x): x is Invoice => !!x));
  }
  let lockedNow = 0n, paidOut = 0n;
  for (const inv of all) {
    if (["Funded", "Delivered", "Disputed"].includes(inv.status)) lockedNow += BigInt(heldAmount(inv));
    if (inv.status === "Released") paidOut += BigInt(inv.amount);
    else if (inv.status !== "AwaitingPayment" && inv.status !== "Cancelled") paidOut += BigInt(inv.upfront);
  }
  // Recent money movement: paid, delivered, released, disputed or refunded (unpaid drafts are left out).
  const recent = all
    .filter((i) => i.status !== "Cancelled" && i.status !== "AwaitingPayment")
    .sort((a, b) => Number(b.funded_at ?? 0) - Number(a.funded_at ?? 0))
    .slice(0, 6);
  return { invoices: last, lockedNow, paidOut, recent };
}

/** "3 min ago" from a nanosecond timestamp. */
export function ago(ns: string | null): string {
  if (!ns) return "";
  const s = Math.max(0, (Date.now() - Number(BigInt(ns) / 1_000_000n)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}
