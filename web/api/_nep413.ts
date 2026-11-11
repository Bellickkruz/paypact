// Verifies NEP-413 signed messages: the free, off-chain signatures NEAR wallets
// produce with signMessage. (Files starting with "_" are not Vercel routes.)
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

const NEP413_TAG = 2 ** 31 + 413;

function borshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

/** The bytes a wallet signs for signMessage({ message, nonce, recipient }). */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const payload = Buffer.concat([
    tag,
    borshString(message),
    Buffer.from(nonce),
    borshString(recipient),
    Buffer.from([0]), // callbackUrl: None
  ]);
  return createHash("sha256").update(payload).digest();
}

/** Signature may arrive as base64 (most wallets) or base58. */
function decodeSignature(sig: string): Uint8Array {
  const raw = sig.replace(/^ed25519:/, "");
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 64) return b64;
  return bs58.decode(raw);
}

export function verifyNep413(params: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  publicKey: string;
  signature: string;
}): boolean {
  if (!params.publicKey.startsWith("ed25519:") || params.nonce.length !== 32) return false;
  try {
    const pk = bs58.decode(params.publicKey.slice("ed25519:".length));
    return ed25519.verify(decodeSignature(params.signature), nep413Hash(params.message, params.nonce, params.recipient), pk);
  } catch {
    return false;
  }
}
