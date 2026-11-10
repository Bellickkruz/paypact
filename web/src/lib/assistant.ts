// The invoice assistant acts with a NEAR function-call key that can only call
// create_invoice and mark_delivered on PayPact. Function-call keys can never
// attach a deposit, and every PayPact method that moves money requires one, so
// whatever the assistant is told, it cannot pay out, refund or redirect funds.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { config } from "./config";
import { addAssistantKey, TGAS } from "./wallet";

export const ASSISTANT_METHODS = ["create_invoice", "mark_delivered"];
const storageKey = (accountId: string) => `paypact:${config.contract}:assistant:${accountId}`;

export function loadAssistantKey(accountId: string): string | null {
  try {
    return localStorage.getItem(storageKey(accountId));
  } catch {
    return null;
  }
}

/** Create a limited key, ask the wallet to add it once, and keep it in this browser. */
export async function enableAssistant(accountId: string): Promise<void> {
  const kp = KeyPair.fromRandom("ed25519");
  await addAssistantKey(kp.getPublicKey().toString(), ASSISTANT_METHODS);
  localStorage.setItem(storageKey(accountId), kp.toString());
}

export function disableAssistant(accountId: string) {
  localStorage.removeItem(storageKey(accountId));
}

function assistantAccount(accountId: string): Account {
  const key = loadAssistantKey(accountId);
  if (!key) throw new Error("Assistant is not enabled");
  return new Account(accountId, new JsonRpcProvider({ url: config.rpc }), KeyPairSigner.fromSecretKey(key as `ed25519:${string}`));
}

/** Call PayPact as the assistant. Any deposit is refused by the network itself. */
export async function assistantCall(
  accountId: string,
  methodName: string,
  args: object,
  deposit: bigint = 0n,
): Promise<unknown> {
  return assistantAccount(accountId).callFunction({
    contractId: config.contract,
    methodName,
    args,
    deposit,
    gas: 50n * TGAS,
  });
}
