// PayPact relayer (Vercel function). Clients have no NEAR account, so their signed
// actions are submitted by this relayer, which only pays gas. The signature is
// checked here before sending (so nobody can burn the relayer's gas with junk),
// and checked again by the contract, which is what actually enforces it.
//
// Freelancers need no NEAR either: they sign a free NEP-413 message in their wallet,
// and the relayer submits create_invoice_for / mark_delivered_for and pays the fee.
//
// Env: NETWORK (testnet|mainnet), PAYPACT_CONTRACT (mainnet), PAYPACT_TOKEN, RELAYER_ACCOUNT_ID, RELAYER_PRIVATE_KEY
// On testnet the contract address comes from the code (TESTNET_CONTRACT below), so a
// redeploy needs no settings change; PAYPACT_CONTRACT_OVERRIDE can still replace it.
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { verifyNep413 } from "./_nep413.js";

const TGAS = 1_000_000_000_000n;
const ACTIONS = new Set(["approve", "dispute", "propose_split", "accept_split", "refund_undelivered", "set_refund_account", "rate"]);
const OPEN_METHODS = new Set(["release_after_review", "resolve_stale_dispute", "retry_payout"]);

export const TESTNET_CONTRACT = "pact.paypact-dev-mwaweex6.testnet";
/** The ready-made freelancer behind the "Try it now" demo (testnet only). */
export const DEMO_FREELANCER = "demo-designer.paypact-dev-mwaweex6.testnet";

function contractId() {
  if (process.env.NETWORK === "mainnet") return env("PAYPACT_CONTRACT");
  return process.env.PAYPACT_CONTRACT_OVERRIDE || TESTNET_CONTRACT;
}

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

// FastNEAR answers in well under a second; the public near.org nodes can take several.
function rpcUrl() {
  return process.env.NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com";
}

/** Return once the transaction has executed (optimistically), not after full finality. */
const FAST = "EXECUTED_OPTIMISTIC" as const;

async function view<T>(provider: JsonRpcProvider, contract: string, method: string, args: Record<string, unknown>): Promise<T> {
  return provider.callFunction({ contractId: contract, method, args }) as Promise<T>;
}

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleRelay(body: any, origin = ""): Promise<Response> {
  const contract = contractId();
  const provider = new JsonRpcProvider({ url: rpcUrl() });
  if (body?.method === "gasless") return gasless(provider, contract, body);
  const testnet = process.env.NETWORK !== "mainnet";
  if (body?.method === "demo_create" && testnet) return demoCreate(provider, contract);
  if (body?.method === "demo_deliver" && testnet) return demoDeliver(provider, contract, String(body.invoice_id ?? ""), origin);
  const invoiceId = String(body?.invoice_id ?? "");
  if (!/^\d{1,18}$/.test(invoiceId)) return json(400, { error: "Bad invoice id" });

  let args: object;
  if (body.method === "client_action") {
    const { action, signature } = body;
    if (!action || !ACTIONS.has(action.type) || typeof signature !== "string") return json(400, { error: "Bad action" });
    const [invoice, message] = await Promise.all([
      view<{ client_key: string | null } | null>(provider, contract, "get_invoice", { invoice_id: invoiceId }),
      view<string>(provider, contract, "action_message", { invoice_id: invoiceId, action }).catch(() => ""),
    ]);
    if (!invoice?.client_key) return json(400, { error: "Invoice is not paid yet" });
    let ok = false;
    try {
      ok = ed25519.verify(bs58.decode(signature), new TextEncoder().encode(message), bs58.decode(invoice.client_key.replace("ed25519:", "")));
    } catch {
      ok = false;
    }
    if (!ok) return json(401, { error: "Signature does not match this invoice's client" });
    args = { invoice_id: invoiceId, action, signature };
  } else if (OPEN_METHODS.has(body.method)) {
    args = { invoice_id: invoiceId };
  } else if (body.method === "demo_pay" && process.env.NETWORK !== "mainnet") {
    // Testnet only: pay an invoice with the free test token, standing in for the
    // NEAR Intents delivery that happens on mainnet.
    return demoPay(provider, contract, invoiceId, String(body.client_key ?? ""));
  } else {
    return json(400, { error: "Unknown method" });
  }

  const relayer = new Account(
    env("RELAYER_ACCOUNT_ID"),
    provider,
    KeyPairSigner.fromSecretKey(env("RELAYER_PRIVATE_KEY") as `ed25519:${string}`),
  );
  try {
    const outcome = await relayer.callFunctionRaw({
      contractId: contract,
      methodName: body.method,
      args,
      gas: 150n * TGAS,
      waitUntil: FAST,
    });
    const failure = (outcome.status as { Failure?: unknown })?.Failure;
    if (failure) return json(422, { error: JSON.stringify(failure).slice(0, 300) });
    return json(200, { hash: outcome.transaction.hash });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300);
    return json(422, { error: msg });
  }
}

async function demoPay(provider: JsonRpcProvider, contract: string, invoiceId: string, clientKey: string) {
  let keyBytes = 0;
  try {
    keyBytes = bs58.decode(clientKey.replace(/^ed25519:/, "")).length;
  } catch {
    keyBytes = 0;
  }
  if (!clientKey.startsWith("ed25519:") || keyBytes !== 32) return json(400, { error: "Bad client key" });
  const token = env("PAYPACT_TOKEN");
  const invoice = await view<{ amount: string; status: string; token: string } | null>(provider, contract, "get_invoice", {
    invoice_id: invoiceId,
  });
  if (!invoice || invoice.status !== "AwaitingPayment") return json(400, { error: "Invoice is not awaiting payment" });
  if (invoice.token !== token) return json(400, { error: "Unexpected token" });
  const relayerId = env("RELAYER_ACCOUNT_ID");
  const relayer = new Account(relayerId, provider, KeyPairSigner.fromSecretKey(env("RELAYER_PRIVATE_KEY") as `ed25519:${string}`));
  try {
    await relayer.callFunction({ contractId: token, methodName: "mint", args: { account_id: relayerId, amount: invoice.amount }, gas: 30n * TGAS, waitUntil: FAST });
    const outcome = await relayer.callFunctionRaw({
      contractId: token,
      methodName: "ft_transfer_call",
      args: { receiver_id: contract, amount: invoice.amount, msg: JSON.stringify({ invoice_id: invoiceId, client_key: clientKey }) },
      deposit: 1n,
      gas: 150n * TGAS,
      waitUntil: FAST,
    });
    return json(200, { hash: outcome.transaction.hash });
  } catch (e) {
    return json(422, { error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300) });
  }
}

// ---------------------------------------------------------------- gasless freelancer actions

export const GASLESS_RECIPIENT = "PayPact";
const GASLESS_ACTIONS = new Set(["create_invoice", "mark_delivered"]);
const MAX_AGE_MS = 10 * 60_000;

function relayerAccount(provider: JsonRpcProvider) {
  return new Account(env("RELAYER_ACCOUNT_ID"), provider, KeyPairSigner.fromSecretKey(env("RELAYER_PRIVATE_KEY") as `ed25519:${string}`));
}

/** Is `publicKey` a full-access key of `accountId`? (A function-call key can't stand in for the owner.) */
async function isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "paypact", method: "query",
      params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey },
    }),
  });
  const j = await res.json();
  return j?.result?.permission === "FullAccess";
}

async function gasless(provider: JsonRpcProvider, contract: string, body: any): Promise<Response> {
  const { message, nonce, signed } = body ?? {};
  if (typeof message !== "string" || typeof nonce !== "string" || !signed?.accountId || !signed?.publicKey || !signed?.signature) {
    return json(400, { error: "Bad signed request" });
  }
  let req: { app?: string; contract?: string; action?: string; args?: Record<string, unknown>; issued_at?: number };
  try {
    req = JSON.parse(message);
  } catch {
    return json(400, { error: "Bad message" });
  }
  if (req.app !== GASLESS_RECIPIENT || req.contract !== contract || !GASLESS_ACTIONS.has(String(req.action)) || !req.args) {
    return json(400, { error: "Message is not a PayPact request for this contract" });
  }
  if (typeof req.issued_at !== "number" || Math.abs(Date.now() - req.issued_at) > MAX_AGE_MS) {
    return json(400, { error: "Request expired; please try again" });
  }
  const ok = verifyNep413({
    message, nonce: Buffer.from(nonce, "base64"), recipient: GASLESS_RECIPIENT,
    publicKey: signed.publicKey, signature: signed.signature,
  });
  if (!ok) return json(401, { error: "Signature check failed" });
  const accountId = String(signed.accountId);
  if (!(await isFullAccessKey(accountId, signed.publicKey))) {
    return json(401, { error: "That key doesn't belong to this account" });
  }

  const relayer = relayerAccount(provider);
  try {
    if (req.action === "create_invoice") {
      // Make sure the freelancer can receive the stablecoin, so payouts never bounce.
      const token = String(req.args.token ?? "");
      if (token !== env("PAYPACT_TOKEN")) return json(400, { error: "Unsupported token" });
      const registered = await provider.callFunction({ contractId: token, method: "storage_balance_of", args: { account_id: accountId } });
      if (!registered) {
        const bounds = (await provider.callFunction({ contractId: token, method: "storage_balance_bounds", args: {} })) as { min: string };
        await relayer.callFunction({
          contractId: token, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true },
          deposit: BigInt(bounds.min), gas: 30n * TGAS, waitUntil: FAST,
        });
      }
      const id = await relayer.callFunction({
        contractId: contract, methodName: "create_invoice_for", args: { ...req.args, freelancer: accountId }, gas: 50n * TGAS,
        waitUntil: FAST,
      });
      return json(200, { invoice_id: String(id) });
    }
    await relayer.callFunction({
      contractId: contract, methodName: "mark_delivered_for",
      args: {
        freelancer: accountId,
        invoice_id: String(req.args.invoice_id ?? ""),
        link: typeof req.args.link === "string" ? req.args.link : null,
        note: typeof req.args.note === "string" ? req.args.note : null,
      },
      gas: 50n * TGAS,
      waitUntil: FAST,
    });
    return json(200, { ok: true });
  } catch (e) {
    return json(422, { error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300) });
  }
}

// ---------------------------------------------------------------- "Try it now" demo (testnet)

const DEMO_JOBS = [
  { title: "Logo and brand kit for Bloom Café", amount: 250, upfront: 30 },
  { title: "Landing page design for Kola Fitness", amount: 400, upfront: 0 },
  { title: "Product photos retouch (20 images)", amount: 120, upfront: 50 },
  { title: "Instagram launch posts (10 designs)", amount: 180, upfront: 0 },
  { title: "Pitch deck redesign for Lumen Labs", amount: 300, upfront: 30 },
];

/** A fresh invoice from the demo freelancer, so anyone can try the client side without a wallet. */
async function demoCreate(provider: JsonRpcProvider, contract: string) {
  const job = DEMO_JOBS[Math.floor(Math.random() * DEMO_JOBS.length)];
  try {
    const id = await relayerAccount(provider).callFunction({
      contractId: contract, methodName: "create_invoice_for", gas: 50n * TGAS, waitUntil: FAST,
      args: {
        freelancer: DEMO_FREELANCER, token: env("PAYPACT_TOKEN"), amount: String(job.amount * 1_000_000),
        title: job.title, due_in_days: 5, review_days: 3, arbiter: null, upfront_percent: job.upfront,
      },
    });
    return json(200, { invoice_id: String(id) });
  } catch (e) {
    return json(422, { error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300) });
  }
}

/** The demo freelancer "delivers" (only for its own funded invoices), with proof attached. */
async function demoDeliver(provider: JsonRpcProvider, contract: string, invoiceId: string, origin: string) {
  if (!/^\d{1,18}$/.test(invoiceId)) return json(400, { error: "Bad invoice id" });
  const inv = await view<{ freelancer: string; status: string } | null>(provider, contract, "get_invoice", { invoice_id: invoiceId });
  if (!inv || inv.freelancer !== DEMO_FREELANCER) return json(400, { error: "Not a demo invoice" });
  if (inv.status !== "Funded") return json(400, { error: "The invoice must be paid first" });
  const base = /^https:\/\/[a-z0-9.-]+$/i.test(origin) ? origin : "https://paypact-alpha.vercel.app";
  try {
    await relayerAccount(provider).callFunction({
      contractId: contract, methodName: "mark_delivered_for", gas: 50n * TGAS, waitUntil: FAST,
      args: {
        freelancer: DEMO_FREELANCER, invoice_id: invoiceId,
        link: `${base}/demo-delivery.html`,
        note: "Final files attached: logo (SVG, PNG), colours and fonts. Thanks for the clear brief!",
      },
    });
    return json(200, { ok: true });
  } catch (e) {
    return json(422, { error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300) });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  return handleRelay(body, new URL(request.url).origin);
}
