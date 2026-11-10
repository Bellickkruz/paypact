// "Pay with any crypto": NEAR Intents 1Click swaps the client's token on its
// own chain into USDC on NEAR and delivers it to the PayPact contract with
// ft_transfer_call, carrying the invoice id (customRecipientMsg).
import { config } from "./config";

const API = "https://1click.chaindefuser.com/v0";

export interface IntentToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price?: number;
}

export interface Quote {
  depositAddress: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  minAmountIn?: string;
  amountOut: string;
  timeEstimate?: number;
  deadline?: string;
}

/** The choices shown to clients, in the order people are most likely to hold them. */
export const PAY_OPTIONS: { assetId: string; label: string; chain: string; addressHint: string }[] = [
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC", chain: "Base", addressHint: "0x…" },
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", label: "USDC", chain: "Ethereum", addressHint: "0x…" },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", label: "USDC", chain: "Solana", addressHint: "Solana address" },
  { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", label: "USDT", chain: "Tron", addressHint: "T…" },
  { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", label: "USDT", chain: "Ethereum", addressHint: "0x…" },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", label: "USDC", chain: "Arbitrum", addressHint: "0x…" },
  { assetId: "nep141:eth.omft.near", label: "ETH", chain: "Ethereum", addressHint: "0x…" },
  { assetId: "nep141:base.omft.near", label: "ETH", chain: "Base", addressHint: "0x…" },
  { assetId: "nep141:sol.omft.near", label: "SOL", chain: "Solana", addressHint: "Solana address" },
  { assetId: "nep141:btc.omft.near", label: "BTC", chain: "Bitcoin", addressHint: "bc1…" },
];

/** Ask 1Click for a deposit address that will pay exactly `amountOut` USDC into the invoice. */
export async function quotePayment(params: {
  originAsset: string;
  amountOut: string;
  refundTo: string;
  msg: string;
  dry?: boolean;
}): Promise<Quote> {
  const res = await fetch(`${API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: params.dry ?? false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: params.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: `nep141:${config.token}`,
      amount: params.amountOut,
      recipient: config.contract,
      recipientType: "DESTINATION_CHAIN",
      customRecipientMsg: params.msg,
      refundTo: params.refundTo,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      referral: "paypact",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `Quote failed (${res.status})`);
  return json.quote as Quote;
}

export type SwapStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export async function swapStatus(depositAddress: string, memo?: string): Promise<SwapStatus> {
  const q = new URLSearchParams({ depositAddress, ...(memo ? { depositMemo: memo } : {}) });
  const res = await fetch(`${API}/status?${q}`);
  const json = await res.json();
  return json.status as SwapStatus;
}

/** Rough check that an address fits the chain, to catch obvious paste mistakes. */
export function looksLikeAddress(chain: string, addr: string): boolean {
  const a = addr.trim();
  if (["Base", "Ethereum", "Arbitrum"].includes(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (chain === "Solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (chain === "Tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (chain === "Bitcoin") return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a);
  return a.length > 10;
}
