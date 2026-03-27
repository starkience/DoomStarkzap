import { useState, useCallback } from "react";
import { connectWallet, depositToArena, withdrawFromArena, getUSDCBalance } from "../lib/starkzap";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { address: addr } = await connectWallet();
      setAddress(addr);
      // Fetch initial balance
      try {
        const bal = await getUSDCBalance();
        setBalance(bal);
      } catch {
        // Balance fetch may fail, non-critical
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const deposit = useCallback(async (matchId: string): Promise<string | null> => {
    setError(null);
    try {
      const txHash = await depositToArena(matchId);
      // Refresh balance after deposit
      try {
        const bal = await getUSDCBalance();
        setBalance(bal);
      } catch { /* non-critical */ }
      return txHash;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
      return null;
    }
  }, []);

  const withdraw = useCallback(async (matchId: string): Promise<string | null> => {
    setError(null);
    try {
      const txHash = await withdrawFromArena(matchId);
      try {
        const bal = await getUSDCBalance();
        setBalance(bal);
      } catch { /* non-critical */ }
      return txHash;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
      return null;
    }
  }, []);

  const setTestAddress = useCallback((addr: string) => {
    setAddress(addr);
    setBalance("TEST MODE");
  }, []);

  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  return {
    address,
    truncatedAddress,
    connecting,
    balance,
    error,
    connect,
    deposit,
    withdraw,
    setTestAddress,
    isConnected: !!address,
  };
}
