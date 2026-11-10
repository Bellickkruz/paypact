// End-to-end run of the escrow on NEAR testnet, with a test token standing in for USDC.
//
//   node e2e-testnet.mjs <path-to-dev-account-key.json>
//
// Creates sub-accounts under the dev account (token, escrow, freelancer), then plays:
//   1. freelancer creates an invoice            5. client approves (signed message, relayed)
//   2. client pays it with ft_transfer_call      6. freelancer is paid
//   3. AI key (function-call only) tries to steal: rejected by the network
//   4. AI key marks the work delivered
import { readFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

const RPC = "https://rpc.testnet.near.org";
const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const ONE_YOCTO = 1n;

const keyFile = process.argv[2];
if (!keyFile) throw new Error("usage: node e2e-testnet.mjs <dev-account-key.json>");
const dev = JSON.parse(readFileSync(keyFile, "utf8"));
const provider = new JsonRpcProvider({ url: RPC });
const devAccount = new Account(dev.account_id, provider, KeyPairSigner.fromSecretKey(dev.private_key));

const run = Date.now().toString(36).slice(-5);
const ids = {
  token: `tusdc${run}.${dev.account_id}`,
  escrow: `escrow${run}.${dev.account_id}`,
  tolu: `tolu${run}.${dev.account_id}`,
};

const step = (n, text) => console.log(`\n[${n}] ${text}`);
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const balance = async (who) => BigInt(await view(ids.token, "ft_balance_of", { account_id: who }));
const usdc = (units) => `${Number(units) / 1e6} tUSDC`;

async function subAccount(id, nearAmount) {
  const kp = KeyPair.fromRandom("ed25519");
  await devAccount.createSubAccount({
    accountOrPrefix: id,
    publicKey: kp.getPublicKey(),
    nearToTransfer: nearAmount,
  });
  return { account: new Account(id, provider, KeyPairSigner.fromSecretKey(kp.toString())), kp };
}

const call = (account, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  account.callFunction({ contractId, methodName, args, deposit, gas });

// --- setup -----------------------------------------------------------------
step(0, `Deploying test token and escrow under ${dev.account_id}`);
const token = await subAccount(ids.token, 3n * NEAR);
await token.account.deployContract(readFileSync("../test-token/target/near/test_token.wasm"));
await call(token.account, ids.token, "new", {});

const escrow = await subAccount(ids.escrow, 4n * NEAR);
await escrow.account.deployContract(readFileSync("../contract/target/near/invoice_escrow.wasm"));
await call(escrow.account, ids.escrow, "new", { owner: dev.account_id, allowed_tokens: [ids.token] });

const tolu = await subAccount(ids.tolu, 2n * NEAR);
// Register the escrow and freelancer with the token, and give the "client" (dev) 10 tUSDC.
for (const who of [ids.escrow, ids.tolu]) await call(devAccount, ids.token, "mint", { account_id: who, amount: "0" });
await call(devAccount, ids.token, "mint", { account_id: dev.account_id, amount: "10000000" });
console.log(`   token=${ids.token}\n   escrow=${ids.escrow}\n   freelancer=${ids.tolu}`);

// --- 1. invoice ------------------------------------------------------------
step(1, "Tolu creates a 5 tUSDC invoice");
const invoiceId = await call(tolu.account, ids.escrow, "create_invoice", {
  token: ids.token, amount: "5000000", title: "Logo design", due_in_days: 7, review_days: 5,
});
console.log(`   invoice #${invoiceId}`);

// --- 2. payment ------------------------------------------------------------
step(2, "Sarah pays with ft_transfer_call (what NEAR Intents does after a cross-chain swap)");
const clientSecret = ed25519.utils.randomPrivateKey();
const clientKey = `ed25519:${bs58.encode(ed25519.getPublicKey(clientSecret))}`;
await call(devAccount, ids.token, "ft_transfer_call", {
  receiver_id: ids.escrow,
  amount: "5000000",
  msg: JSON.stringify({ invoice_id: invoiceId, client_key: clientKey }),
}, ONE_YOCTO);
let inv = await view(ids.escrow, "get_invoice", { invoice_id: invoiceId });
console.log(`   status=${inv.status}  escrow holds ${usdc(await balance(ids.escrow))}`);

// --- 3. AI assistant key ---------------------------------------------------
step(3, "Tolu gives her AI assistant a function-call key limited to create_invoice + mark_delivered");
const aiKey = KeyPair.fromRandom("ed25519");
await tolu.account.addFunctionCallAccessKey({
  publicKey: aiKey.getPublicKey(),
  contractId: ids.escrow,
  methodNames: ["create_invoice", "mark_delivered"],
  allowance: NEAR / 4n,
});
const ai = new Account(ids.tolu, provider, KeyPairSigner.fromSecretKey(aiKey.toString()));

async function expectRejected(label, fn) {
  try {
    await fn();
    console.log(`   ✗ ${label}: NOT rejected`);
    process.exitCode = 1;
  } catch (e) {
    console.log(`   ✓ ${label}: rejected (${String(e.message ?? e).split("\n")[0].slice(0, 110)})`);
  }
}
await expectRejected("AI tries to refund the escrow to itself", () =>
  call(ai, ids.escrow, "refund_client", { invoice_id: invoiceId }, ONE_YOCTO));
await expectRejected("AI tries to transfer tokens directly", () =>
  call(ai, ids.token, "ft_transfer", { receiver_id: dev.account_id, amount: "1" }, ONE_YOCTO));

step(4, "The AI assistant marks the work delivered (allowed)");
await call(ai, ids.escrow, "mark_delivered", { invoice_id: invoiceId }, 0n, 30n * TGAS);
inv = await view(ids.escrow, "get_invoice", { invoice_id: invoiceId });
console.log(`   status=${inv.status}`);

// --- 5. approval -----------------------------------------------------------
step(5, "Sarah approves with a signed message; anyone can relay it");
const action = { type: "approve" };
const message = await view(ids.escrow, "action_message", { invoice_id: invoiceId, action });
const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), clientSecret));
const before = await balance(ids.tolu);
await call(devAccount, ids.escrow, "client_action", { invoice_id: invoiceId, action, signature }, 0n, 100n * TGAS);

step(6, "Result");
inv = await view(ids.escrow, "get_invoice", { invoice_id: invoiceId });
const after = await balance(ids.tolu);
console.log(`   status=${inv.status}  Tolu received ${usdc(after - before)}  escrow now ${usdc(await balance(ids.escrow))}`);
if (inv.status !== "Released" || after - before !== 5000000n) process.exitCode = 1;
console.log(process.exitCode ? "\nE2E FAILED" : "\nE2E PASSED");
