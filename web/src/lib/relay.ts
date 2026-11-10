// Client actions are signed in the browser and submitted by the PayPact relayer,
// which pays the gas. The contract checks the signature, so the relayer cannot
// act for anyone.
import { actionMessage, type ClientAction } from "./near";
import { signWith } from "./clientKey";

export async function relay(body: object): Promise<{ hash: string }> {
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Relay failed (${res.status})`);
  return json;
}

export async function sendClientAction(invoiceId: string, secret: string, action: ClientAction) {
  const message = await actionMessage(invoiceId, action);
  const signature = signWith(secret, message);
  return relay({ method: "client_action", invoice_id: invoiceId, action, signature });
}
