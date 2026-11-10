// PayPact relayer (Vercel function). Clients have no NEAR account, so their signed
// actions are submitted by this relayer, which only pays gas. The signature is
// checked here before sending (so nobody can burn the relayer's gas with junk),
// and checked again by the contract, which is what actually enforces it.
//
// Env: NETWORK (testnet|mainnet), PAYPACT_CONTRACT, RELAYER_ACCOUNT_ID, RELAYER_PRIVATE_KEY
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

const TGAS = 1_000_000_000_000n;
const ACTIONS = new Set(["approve", "dispute", "propose_split", "accept_split", "refund_undelivered", "set_refund_account", "rate"]);
const OPEN_METHODS = new Set(["release_after_review", "resolve_stale_dispute", "retry_payout"]);

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

function rpcUrl() {
  return process.env.NETWORK === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org";
}

async function view<T>(provider: JsonRpcProvider, contract: string, method: string, args: Record<string, unknown>): Promise<T> {
  return provider.callFunction({ contractId: contract, method, args }) as Promise<T>;
}

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleRelay(body: any): Promise<Response> {
  const contract = env("PAYPACT_CONTRACT");
  const provider = new JsonRpcProvider({ url: rpcUrl() });
  const invoiceId = String(body?.invoice_id ?? "");
  if (!/^\d{1,18}$/.test(invoiceId)) return json(400, { error: "Bad invoice id" });

  let args: object;
  if (body.method === "client_action") {
    const { action, signature } = body;
    if (!action || !ACTIONS.has(action.type) || typeof signature !== "string") return json(400, { error: "Bad action" });
    const invoice = await view<{ client_key: string | null } | null>(provider, contract, "get_invoice", { invoice_id: invoiceId });
    if (!invoice?.client_key) return json(400, { error: "Invoice is not paid yet" });
    const message = await view<string>(provider, contract, "action_message", { invoice_id: invoiceId, action });
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
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(clientKey)) return json(400, { error: "Bad client key" });
  const token = env("PAYPACT_TOKEN");
  const invoice = await view<{ amount: string; status: string; token: string } | null>(provider, contract, "get_invoice", {
    invoice_id: invoiceId,
  });
  if (!invoice || invoice.status !== "AwaitingPayment") return json(400, { error: "Invoice is not awaiting payment" });
  if (invoice.token !== token) return json(400, { error: "Unexpected token" });
  const relayerId = env("RELAYER_ACCOUNT_ID");
  const relayer = new Account(relayerId, provider, KeyPairSigner.fromSecretKey(env("RELAYER_PRIVATE_KEY") as `ed25519:${string}`));
  try {
    await relayer.callFunction({ contractId: token, methodName: "mint", args: { account_id: relayerId, amount: invoice.amount }, gas: 30n * TGAS });
    const outcome = await relayer.callFunctionRaw({
      contractId: token,
      methodName: "ft_transfer_call",
      args: { receiver_id: contract, amount: invoice.amount, msg: JSON.stringify({ invoice_id: invoiceId, client_key: clientKey }) },
      deposit: 1n,
      gas: 150n * TGAS,
    });
    return json(200, { hash: outcome.transaction.hash });
  } catch (e) {
    return json(422, { error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300) });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  return handleRelay(body);
}
