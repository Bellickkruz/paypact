// Network settings. Testnet uses a test stablecoin; mainnet uses native USDC on NEAR.
export type Network = "testnet" | "mainnet";

const network: Network = import.meta.env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";

const defaults = {
  testnet: {
    contract: "pact.paypact-dev-mwaweex6.testnet",
    demoFreelancer: "demo-designer.paypact-dev-mwaweex6.testnet",
    token: "tusdcwer0a.paypact-dev-mwaweex6.testnet",
    symbol: "tUSDC",
    rpc: "https://rpc.testnet.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
  },
  mainnet: {
    contract: "paypact.near",
    token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    symbol: "USDC",
    rpc: "https://rpc.mainnet.fastnear.com",
    explorer: "https://nearblocks.io",
    demoFreelancer: "",
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
  /** The ready-made freelancer behind "Try it now" (testnet only). */
  demoFreelancer: defaults.demoFreelancer,
};

/** Is this invoice from the "Try it now" demo freelancer? */
export const isDemo = (freelancer: string) => !!config.demoFreelancer && freelancer === config.demoFreelancer;
/** A friendly name for known accounts. */
export const displayName = (account: string) => (isDemo(account) ? "Demo Designer" : account);

export const txUrl = (hash: string) => `${config.explorer}/txns/${hash}`;
export const accountUrl = (id: string) => `${config.explorer}/address/${id}`;
