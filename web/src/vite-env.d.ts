/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_NETWORK?: "testnet" | "mainnet";
  readonly VITE_CONTRACT?: string;
  readonly VITE_TOKEN?: string;
}
