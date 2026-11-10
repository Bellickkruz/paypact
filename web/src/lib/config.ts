// Network settings. Testnet uses a test stablecoin; mainnet uses native USDC on NEAR.
export type Network = "testnet" | "mainnet";

const network: Network = import.meta.env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";

const defaults = {
  testnet: {
    contract: "escrowwer0a.paypact-dev-mwaweex6.testnet",
    token: "tusdcwer0a.paypact-dev-mwaweex6.testnet",
    symbol: "tUSDC",
    rpc: "https://rpc.testnet.near.org",
    explorer: "https://testnet.nearblocks.io",
  },
  mainnet: {
    contract: "paypact.near",
    token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    symbol: "USDC",
    rpc: "https://rpc.mainnet.near.org",
    explorer: "https://nearblocks.io",
  },
}[network];

export const config = {
  network,
  contract: import.meta.env.VITE_CONTRACT || defaults.contract,
  token: import.meta.env.VITE_TOKEN || defaults.token,
  symbol: defaults.symbol,
  decimals: 6,
  rpc: defaults.rpc,
  explorer: defaults.explorer,
  /** "Pay with any crypto" needs NEAR Intents, which only runs on mainnet. */
  anyChain: network === "mainnet",
};

export const txUrl = (hash: string) => `${config.explorer}/txns/${hash}`;
export const accountUrl = (id: string) => `${config.explorer}/address/${id}`;
