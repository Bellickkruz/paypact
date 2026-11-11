// Read-only calls to the PayPact contract over public JSON-RPC.
import { config } from "./config";

export type Status =
  | "AwaitingPayment"
  | "Funded"
  | "Delivered"
  | "Disputed"
  | "Released"
  | "Refunded"
  | "Split"
  | "Cancelled";

export interface Invoice {
  id: string;
  freelancer: string;
  token: string;
  amount: string;
  upfront: string;
  title: string;
  created_at: string;
  due_at: string;
  review_days: number;
  dispute_timeout_days: number;
  arbiter: string | null;
  status: Status;
  client_key: string | null;
  client_refund_to: string | null;
  funded_at: string | null;
  delivered_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  proposal: { by: "Freelancer" | "Client"; to_freelancer: string } | null;
  client_nonce: number;
  owed_freelancer: string;
  owed_client: string;
  rating: { stars: number; comment: string | null; at: string } | null;
  /** Proof of delivery, recorded on-chain when the work was marked delivered. */
  delivery: { link: string | null; note: string | null } | null;
  /** Set when this invoice is one milestone of a project (paid once, released milestone by milestone). */
  project: { id: string; index: number; count: number; title: string; total: string } | null;
}

export interface Profile {
  invoices_paid: number;
  completed: number;
  split: number;
  refunded: number;
  disputed: number;
  delivered: number;
  delivered_on_time: number;
  total_earned: string;
  rating_sum: number;
  rating_count: number;
}

export type ClientAction =
  | { type: "approve" }
  | { type: "dispute"; reason: string }
  | { type: "propose_split"; to_freelancer: string }
  | { type: "accept_split" }
  | { type: "refund_undelivered" }
  | { type: "set_refund_account"; account: string }
  | { type: "rate"; stars: number; comment: string | null };

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(config.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "paypact", method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.data ?? json.error.message ?? "RPC error");
  return json.result as T;
}

export async function viewOn<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const result = await rpc<{ result: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  });
  if (result.error) throw new Error(result.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

export const view = <T>(method: string, args: object = {}) => viewOn<T>(config.contract, method, args);

export const getInvoice = (id: string) => view<Invoice | null>("get_invoice", { invoice_id: id });
export const getInvoicesFor = (freelancer: string) =>
  view<Invoice[]>("get_invoices_for", { freelancer, from: 0, limit: 100 });
/** Every milestone of a project, in order (`id` is the first milestone's id). */
export const getProject = (id: string) => view<Invoice[]>("get_project", { project_id: id });
export const getProfile = (account_id: string) => view<[Profile, number]>("get_profile", { account_id });
export const actionMessage = (invoice_id: string, action: ClientAction) =>
  view<string>("action_message", { invoice_id, action });
export const tokenBalance = (account_id: string) =>
  viewOn<string>(config.token, "ft_balance_of", { account_id });

/** Money still held in escrow for this invoice. */
export const heldAmount = (inv: Invoice) => (BigInt(inv.amount) - BigInt(inv.upfront)).toString();
