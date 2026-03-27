#!/usr/bin/env node
/**
 * Deploy script for DoomStarkzap:
 * 1. Deploy the operator OZ account (if not yet deployed)
 * 2. Declare the DoomArena contract class
 * 3. Deploy the DoomArena contract instance
 *
 * Usage:
 *   node scripts/deploy.mjs deploy-account   # Step 1: deploy the operator account
 *   node scripts/deploy.mjs deploy-contract  # Step 2: declare + deploy DoomArena
 */

import { RpcProvider, Account, stark, ec, hash, CallData, Contract } from "starknet";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL = "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/X8smY12kO8orpiWArSDwb";
const PRIVATE_KEY = "0x10cda0d0b97fefea64602c86614c522905b4c965a32c9fa7def3d5fd90f044e";
const PUBLIC_KEY = "0x414810d45729109fb26e5849c71b91da91b44c8b1c69f835b048655af8f2472";
const ACCOUNT_ADDRESS = "0x4ac92d9917621f370f4da0319c0c7b9d8881e1bc181510e3b1872f9f800cfd3";
const OZ_CLASS_HASH = "0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";

const provider = new RpcProvider({ nodeUrl: RPC_URL });

async function deployAccount() {
  console.log("=== Deploying Operator Account ===");
  console.log("Address:", ACCOUNT_ADDRESS);

  // Check if already deployed
  try {
    const nonce = await provider.getNonceForAddress(ACCOUNT_ADDRESS);
    console.log("Account already deployed! Nonce:", nonce);
    return;
  } catch {
    // Not deployed yet, continue
  }

  // Check STRK balance
  const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
  const balResult = await provider.callContract({
    contractAddress: STRK_TOKEN,
    entrypoint: "balanceOf",
    calldata: [ACCOUNT_ADDRESS],
  });
  const balance = BigInt(balResult[0] || "0");
  console.log("STRK Balance:", Number(balance) / 1e18);
  if (balance === 0n) {
    console.log("\nAccount has no funds!");
    console.log("Send STRK to:", ACCOUNT_ADDRESS);
    console.log("Then run this script again.");
    return;
  }

  const account = new Account({ provider, address: ACCOUNT_ADDRESS, signer: PRIVATE_KEY });

  console.log("Deploying account...");
  const { transaction_hash } = await account.deploySelf({
    classHash: OZ_CLASS_HASH,
    constructorCalldata: [PUBLIC_KEY],
    addressSalt: PUBLIC_KEY,
  });

  console.log("Deploy tx:", transaction_hash);
  console.log("Waiting for confirmation...");
  await provider.waitForTransaction(transaction_hash);
  console.log("Account deployed successfully!");
}

async function deployContract() {
  console.log("=== Deploying DoomArena Contract ===");

  const account = new Account({ provider, address: ACCOUNT_ADDRESS, signer: PRIVATE_KEY });

  // Read compiled contract
  const contractPath = resolve(__dirname, "../contracts/target/dev/doom_arena_DoomArena.contract_class.json");
  let contractJson;
  try {
    contractJson = JSON.parse(readFileSync(contractPath, "utf-8"));
  } catch {
    console.error("Contract not compiled! Run: cd contracts && scarb build");
    process.exit(1);
  }

  // Also read the compiled Sierra file for CASM
  const casmPath = resolve(__dirname, "../contracts/target/dev/doom_arena_DoomArena.compiled_contract_class.json");
  let casmJson;
  try {
    casmJson = JSON.parse(readFileSync(casmPath, "utf-8"));
  } catch {
    console.error("CASM not found. Ensure Scarb compiled with sierra = true.");
    console.error("Looking for:", casmPath);
    process.exit(1);
  }

  // Step 1: Declare the contract class
  console.log("Declaring contract class...");
  console.log("Sierra size:", JSON.stringify(contractJson).length, "bytes");
  console.log("CASM size:", JSON.stringify(casmJson).length, "bytes");
  try {
    // Estimate fee first
    const estimateFee = await account.estimateDeclareFee({
      contract: contractJson,
      casm: casmJson,
    });
    console.log("Estimated fee:", estimateFee);

    const declareResponse = await account.declare({
      contract: contractJson,
      casm: casmJson,
    });
    console.log("Declare tx:", declareResponse.transaction_hash);
    console.log("Class hash:", declareResponse.class_hash);
    await provider.waitForTransaction(declareResponse.transaction_hash);
    console.log("Contract class declared!");

    // Step 2: Deploy an instance
    console.log("\nDeploying contract instance...");
    const constructorCalldata = CallData.compile({
      owner: ACCOUNT_ADDRESS,
      operator: ACCOUNT_ADDRESS,
    });

    const deployResponse = await account.deploy({
      classHash: declareResponse.class_hash,
      constructorCalldata,
      salt: stark.randomAddress(),
    });
    console.log("Deploy tx:", deployResponse.transaction_hash);
    await provider.waitForTransaction(deployResponse.transaction_hash);

    const contractAddress = deployResponse.contract_address?.[0] || "unknown";
    console.log("\n=== DoomArena Deployed ===");
    console.log("Contract Address:", contractAddress);
    console.log("\nUpdate server/.env with:");
    console.log(`ARENA_CONTRACT_ADDRESS=${contractAddress}`);
  } catch (err) {
    console.error("Deployment failed:", err.message || err);
    if (err.message?.includes("already declared")) {
      console.log("\nContract class already declared. You may need to deploy an instance manually.");
    }
  }
}

const command = process.argv[2];
if (command === "deploy-account") {
  deployAccount().catch(console.error);
} else if (command === "deploy-contract") {
  deployContract().catch(console.error);
} else {
  console.log("Usage:");
  console.log("  node scripts/deploy.mjs deploy-account    # Deploy operator account");
  console.log("  node scripts/deploy.mjs deploy-contract   # Declare + deploy DoomArena");
}
