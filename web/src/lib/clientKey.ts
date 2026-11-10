// The client's key for one invoice. Clients need no wallet or account: their
// browser makes a key when they pay, and approving, disputing or rating is a
// message signed with it. The key also lives in a private link they can keep.
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { config } from "./config";

const storageKey = (invoiceId: string) => `paypact:${config.contract}:client:${invoiceId}`;

export function newClientSecret(): string {
  return bs58.encode(ed25519.utils.randomPrivateKey());
}

export function saveClientSecret(invoiceId: string, secret: string) {
  try {
    localStorage.setItem(storageKey(invoiceId), secret);
  } catch {
    /* private mode: the private link still works */
  }
}

export function loadClientSecret(invoiceId: string): string | null {
  const fromLink = new URLSearchParams(location.hash.split("?")[1] ?? "").get("k");
  if (fromLink) {
    saveClientSecret(invoiceId, fromLink);
    return fromLink;
  }
  try {
    return localStorage.getItem(storageKey(invoiceId));
  } catch {
    return null;
  }
}

export const publicKeyOf = (secret: string) => `ed25519:${bs58.encode(ed25519.getPublicKey(bs58.decode(secret)))}`;

export const signWith = (secret: string, message: string) =>
  bs58.encode(ed25519.sign(new TextEncoder().encode(message), bs58.decode(secret)));

/** A link that lets the client manage this invoice from any device. */
export const privateLink = (invoiceId: string, secret: string) =>
  `${location.origin}${location.pathname}#/i/${invoiceId}?k=${secret}`;

/** The ft_transfer_call message that pays an invoice. */
export const paymentMsg = (invoiceId: string, secret: string, refundTo?: string) =>
  JSON.stringify({ invoice_id: invoiceId, client_key: publicKeyOf(secret), ...(refundTo ? { refund_to: refundTo } : {}) });
