import { StarkZap, OnboardStrategy, Amount, type Token, type Address } from "starkzap";
import type { Call } from "starknet";

const USDC_TOKEN: Token = {
  name: "USD Coin",
  address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8" as Address,
  decimals: 6,
  symbol: "USDC",
};
const ARENA_CONTRACT = import.meta.env.VITE_ARENA_CONTRACT || "";
const ENTRY_FEE = Amount.parse("1", USDC_TOKEN); // 1 USDC

let sdk: StarkZap | null = null;
let wallet: Awaited<ReturnType<StarkZap["onboard"]>>["wallet"] | null = null;

function getSDK(): StarkZap {
  if (!sdk) {
    sdk = new StarkZap({ network: "mainnet" });
  }
  return sdk;
}

export async function connectWallet(): Promise<{ address: string }> {
  const s = getSDK();
  const result = await s.onboard({
    strategy: OnboardStrategy.Cartridge,
    deploy: "if_needed",
  });
  wallet = result.wallet;
  const address = wallet.address;
  return { address };
}

export function getWallet() {
  return wallet;
}

export async function getUSDCBalance(): Promise<string> {
  if (!wallet) throw new Error("Wallet not connected");
  const balance = await wallet.balanceOf(USDC_TOKEN);
  return balance.toFormatted();
}

export async function depositToArena(matchId: string): Promise<string> {
  if (!wallet) throw new Error("Wallet not connected");
  if (!ARENA_CONTRACT) throw new Error("Arena contract not configured");

  const depositCall: Call = {
    contractAddress: ARENA_CONTRACT,
    entrypoint: "deposit",
    calldata: [matchId],
  };

  const tx = await wallet
    .tx()
    .approve(USDC_TOKEN, ARENA_CONTRACT, ENTRY_FEE)
    .add(depositCall)
    .send();

  return String(tx);
}

export async function withdrawFromArena(matchId: string): Promise<string> {
  if (!wallet) throw new Error("Wallet not connected");
  if (!ARENA_CONTRACT) throw new Error("Arena contract not configured");

  const withdrawCall: Call = {
    contractAddress: ARENA_CONTRACT,
    entrypoint: "withdraw",
    calldata: [matchId],
  };

  const tx = await wallet.tx().add(withdrawCall).send();
  return String(tx);
}
