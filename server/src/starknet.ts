import { RpcProvider, Account, Contract, cairo } from "starknet";

const ARENA_ABI = [
  {
    name: "create_match",
    type: "function",
    inputs: [{ name: "match_id", type: "felt" }],
    outputs: [],
    state_mutability: "external",
  },
  {
    name: "lock_match",
    type: "function",
    inputs: [{ name: "match_id", type: "felt" }],
    outputs: [],
    state_mutability: "external",
  },
  {
    name: "record_kill",
    type: "function",
    inputs: [
      { name: "match_id", type: "felt" },
      { name: "killer", type: "felt" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    name: "settle_match",
    type: "function",
    inputs: [{ name: "match_id", type: "felt" }],
    outputs: [],
    state_mutability: "external",
  },
  {
    name: "get_balance",
    type: "function",
    inputs: [
      { name: "match_id", type: "felt" },
      { name: "player", type: "felt" },
    ],
    outputs: [{ name: "balance", type: "Uint256" }],
    state_mutability: "view",
  },
] as const;

let provider: RpcProvider;
let operatorAccount: Account;
let arenaContract: Contract;

export function initStarknet(): void {
  const rpcUrl = process.env.STARKNET_RPC_URL;
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  const arenaAddress = process.env.ARENA_CONTRACT_ADDRESS;

  if (!rpcUrl || !privateKey || !operatorAddress || !arenaAddress) {
    console.warn(
      "[starknet] Missing env vars (STARKNET_RPC_URL, OPERATOR_PRIVATE_KEY, OPERATOR_ADDRESS, ARENA_CONTRACT_ADDRESS). On-chain features disabled."
    );
    return;
  }

  provider = new RpcProvider({ nodeUrl: rpcUrl });
  operatorAccount = new Account({ provider, address: operatorAddress, signer: privateKey });
  arenaContract = new Contract({ abi: ARENA_ABI as unknown as any[], address: arenaAddress, providerOrAccount: operatorAccount });

  console.log("[starknet] Initialized. Operator:", operatorAddress);
  console.log("[starknet] Arena contract:", arenaAddress);
}

export function isStarknetReady(): boolean {
  return !!arenaContract;
}

export async function createMatch(matchId: string): Promise<string> {
  console.log(`[starknet] createMatch(${matchId})`);
  const tx = await operatorAccount.execute({
    contractAddress: arenaContract.address,
    entrypoint: "create_match",
    calldata: [matchId],
  });
  console.log(`[starknet] createMatch tx: ${tx.transaction_hash}`);
  return tx.transaction_hash;
}

export async function lockMatch(matchId: string): Promise<string> {
  console.log(`[starknet] lockMatch(${matchId})`);
  const tx = await operatorAccount.execute({
    contractAddress: arenaContract.address,
    entrypoint: "lock_match",
    calldata: [matchId],
  });
  console.log(`[starknet] lockMatch tx: ${tx.transaction_hash}`);
  return tx.transaction_hash;
}

export async function recordKill(matchId: string, killerAddress: string): Promise<string> {
  console.log(`[starknet] recordKill(${matchId}, ${killerAddress})`);
  const tx = await operatorAccount.execute({
    contractAddress: arenaContract.address,
    entrypoint: "record_kill",
    calldata: [matchId, killerAddress],
  });
  console.log(`[starknet] recordKill tx: ${tx.transaction_hash}`);
  return tx.transaction_hash;
}

export async function settleMatch(matchId: string): Promise<string> {
  console.log(`[starknet] settleMatch(${matchId})`);
  const tx = await operatorAccount.execute({
    contractAddress: arenaContract.address,
    entrypoint: "settle_match",
    calldata: [matchId],
  });
  console.log(`[starknet] settleMatch tx: ${tx.transaction_hash}`);
  return tx.transaction_hash;
}

export async function waitForTx(txHash: string): Promise<void> {
  console.log(`[starknet] waiting for tx: ${txHash}`);
  await provider.waitForTransaction(txHash);
  console.log(`[starknet] tx confirmed: ${txHash}`);
}
