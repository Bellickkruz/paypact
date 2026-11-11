// Freelancer wallet connection (HOT, Meteor, MyNearWallet, Intear, ...) via NEAR Connect.
import { useEffect, useState } from "react";
import { NearConnector } from "@hot-labs/near-connect";
import { config } from "./config";

export const TGAS = 1_000_000_000_000n;
export const ONE_YOCTO = "1";

let connector: NearConnector | null = null;
let current: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function setAccount(id: string | null) {
  current = id;
  listeners.forEach((l) => l(id));
}

function getConnector(): NearConnector {
  if (connector) return connector;
  connector = new NearConnector({ network: config.network, autoConnect: true });
  connector.on("wallet:signIn", (t) => setAccount(t.accounts[0]?.accountId ?? null));
  connector.on("wallet:signOut", () => setAccount(null));
  // Restore a previous session.
  connector
    .wallet()
    .then((w) => w.getAccounts())
    .then((accounts) => setAccount(accounts[0]?.accountId ?? null))
    .catch(() => {});
  return connector;
}

export function useWallet() {
  const [accountId, setId] = useState<string | null>(current);
  useEffect(() => {
    getConnector();
    listeners.add(setId);
    setId(current);
    return () => void listeners.delete(setId);
  }, []);
  return {
    accountId,
    connect: () => getConnector().connect(),
    disconnect: async () => {
      await getConnector().disconnect();
      setAccount(null);
    },
  };
}

/** Call a contract method with the connected wallet. Returns the transaction hash and value. */
export async function callContract(
  methodName: string,
  args: object,
  opts: { deposit?: string; gas?: bigint; receiverId?: string } = {},
): Promise<{ hash: string; value: unknown }> {
  const wallet = await getConnector().wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId: opts.receiverId ?? config.contract,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName,
          args,
          gas: (opts.gas ?? 100n * TGAS).toString(),
          deposit: opts.deposit ?? "0",
        },
      },
    ],
  });
  const status = (outcome as { status?: { SuccessValue?: string; Failure?: unknown } }).status;
  if (status && "Failure" in status && status.Failure) throw new Error(JSON.stringify(status.Failure));
  let value: unknown = undefined;
  if (status?.SuccessValue) {
    try {
      value = JSON.parse(atob(status.SuccessValue));
    } catch {
      value = undefined;
    }
  }
  return { hash: (outcome as { transaction: { hash: string } }).transaction.hash, value };
}

/**
 * Gasless freelancer actions: the wallet signs a free message (NEP-413, no
 * transaction, no fee) and the PayPact relayer submits it and pays the fee.
 */
export async function signedRequest(action: "create_invoice" | "create_project" | "mark_delivered", args: object): Promise<Record<string, string>> {
  const wallet = await getConnector().wallet();
  const message = JSON.stringify({ app: "PayPact", contract: config.contract, action, args, issued_at: Date.now() });
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const signed = await wallet.signMessage({ message, recipient: "PayPact", nonce });
  if (!signed) throw new Error("The wallet didn't return a signature");
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "gasless",
      message,
      nonce: btoa(String.fromCharCode(...nonce)),
      signed: { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/** Add a limited key for the assistant: it can only call these methods and can never attach a deposit. */
export async function addAssistantKey(publicKey: string, methodNames: string[]): Promise<void> {
  const wallet = await getConnector().wallet();
  await wallet.signAndSendTransaction({
    receiverId: (await wallet.getAccounts())[0].accountId,
    actions: [
      {
        type: "AddKey",
        params: {
          publicKey,
          accessKey: {
            permission: {
              receiverId: config.contract,
              methodNames,
              allowance: (250_000_000_000_000_000_000_000n).toString(), // 0.25 NEAR of gas, at most
            },
          },
        },
      },
    ],
  });
}
