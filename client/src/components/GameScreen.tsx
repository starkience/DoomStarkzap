import { useRef, useEffect, useState, useCallback } from "react";
import { initDoom, startDoomGame } from "../lib/doom-bridge";
import { eventBus } from "../lib/event-bus";

const WS_BASE = import.meta.env.VITE_WS_URL || "";

interface Props {
  wsPath: string;
  playerIndex: number;
  playerCount: number;
  nickname: string;
  gamePaused: boolean;
  pauseReason: string;
  balances: Record<string, number>;
  matchResult: { winner: string; balances: Record<string, number> } | null;
  onReportKill: (killerIndex: number, victimIndex: number) => void;
  onWithdraw: () => void;
}

function formatUSDC(microUsdc: number): string {
  return `$${(microUsdc / 1_000_000).toFixed(2)}`;
}

export function GameScreen({
  wsPath,
  playerIndex,
  playerCount,
  nickname,
  gamePaused,
  pauseReason,
  balances,
  matchResult,
  onReportKill,
  onWithdraw,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Loading DOOM...");
  const initialized = useRef(false);

  // Listen for kill events from Doom and report to server
  useEffect(() => {
    const unsub = eventBus.on("doom:kill", (data) => {
      const { killer, victim } = data as { killer: number; victim: number };
      console.log(`[GameScreen] Kill detected: player ${killer} killed player ${victim}`);
      // Only report if we are the killer
      if (killer === playerIndex) {
        onReportKill(killer, victim);
      }
    });
    return unsub;
  }, [playerIndex, onReportKill]);

  useEffect(() => {
    if (!canvasRef.current || initialized.current) return;
    initialized.current = true;

    let wsUrl: string;
    if (WS_BASE) {
      wsUrl = `${WS_BASE}${wsPath}`;
    } else {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${proto}//${window.location.host}${wsPath}`;
    }

    const unsubStatus = eventBus.on("doom:status", (msg) => setStatus(msg as string));
    const unsubStarted = eventBus.on("doom:started", () => setStatus(""));

    const config = {
      canvas: canvasRef.current,
      wsUrl,
      isServer: playerIndex === 0,
      playerCount,
    };

    initDoom(config)
      .then(() => {
        setStatus("Connecting to game...");
        startDoomGame(config);
      })
      .catch((err) => {
        setStatus(`Error: ${err.message}`);
      });

    canvasRef.current.focus();

    return () => {
      unsubStatus();
      unsubStarted();
    };
  }, [wsPath, playerIndex, playerCount]);

  const handleReturnToLobby = useCallback(() => {
    window.location.href = window.location.origin;
  }, []);

  const balanceEntries = Object.entries(balances);

  return (
    <div className="game-screen">
      {/* Balance HUD */}
      {balanceEntries.length > 0 && !matchResult && (
        <div className="balance-hud">
          {balanceEntries.map(([name, bal]) => (
            <div key={name} className={`balance-entry ${name === nickname ? "you" : "opponent"}`}>
              <span className="balance-name">{name === nickname ? "YOU" : name}</span>
              <span className="balance-amount">{formatUSDC(bal)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Status */}
      {status && !gamePaused && !matchResult && (
        <div className="game-status">{status}</div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        id="canvas"
        tabIndex={-1}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Pause overlay — PROCESSING BOUNTY */}
      {gamePaused && !matchResult && (
        <div className="pause-overlay">
          <div className="pause-content">
            <div className="pause-spinner" />
            <h2>{pauseReason || "PROCESSING BOUNTY..."}</h2>
            <p>Confirming on Starknet...</p>
          </div>
        </div>
      )}

      {/* Match ended overlay */}
      {matchResult && (
        <div className="game-over-overlay">
          <h2>{matchResult.winner === nickname ? "VICTORY" : "DEFEATED"}</h2>
          <div className="final-balances">
            {Object.entries(matchResult.balances).map(([name, bal]) => (
              <div key={name} className="final-balance-row">
                <span>{name === nickname ? `${name} (YOU)` : name}</span>
                <span>{formatUSDC(bal)}</span>
              </div>
            ))}
          </div>
          <div className="match-end-actions">
            {matchResult.winner === nickname && (
              <button className="btn btn-primary" onClick={onWithdraw}>
                WITHDRAW EARNINGS
              </button>
            )}
            <button className="btn btn-secondary" onClick={handleReturnToLobby}>
              RETURN TO LOBBY
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
