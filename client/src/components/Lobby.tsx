import { useState } from "react";
import type { PlayerInfo } from "../lib/lobby-protocol";

interface Props {
  roomId: string;
  matchId: string;
  players: PlayerInfo[];
  nickname: string;
  matchLocked: boolean;
  onToggleReady: () => void;
  onStartGame: () => void;
  onLeave: () => void;
  onDeposit: (matchId: string) => Promise<string | null>;
  onConfirmDeposit: (txHash: string) => void;
  error: string | null;
}

export function Lobby({
  roomId,
  matchId,
  players,
  nickname,
  matchLocked,
  onStartGame,
  onLeave,
  onDeposit,
  onConfirmDeposit,
  error,
}: Props) {
  const [depositing, setDepositing] = useState(false);
  const me = players.find((p) => p.nickname === nickname);
  const isCreator = players.length > 0 && players[0].nickname === nickname;
  const isTestMode = me?.walletAddress?.startsWith("0x") && (me.walletAddress.length ?? 0) < 20;

  const handleDeposit = async () => {
    setDepositing(true);
    try {
      const txHash = await onDeposit(matchId);
      if (txHash) {
        onConfirmDeposit(txHash);
      }
    } finally {
      setDepositing(false);
    }
  };

  const copyCode = () => navigator.clipboard.writeText(roomId);
  const shareUrl = `${window.location.origin}?room=${roomId}`;

  return (
    <div className="lobby">
      <div className="logo">
        <h1 className="title">DOOM</h1>
        <h2 className="subtitle">STARKZAP</h2>
      </div>

      <div className="room-info">
        <div className="room-code-section">
          <label>ROOM CODE</label>
          <div className="room-code" onClick={copyCode} title="Click to copy">
            {roomId}
            <span className="copy-hint">CLICK TO COPY</span>
          </div>
        </div>
        <div className="share-url">
          <label>SHARE LINK</label>
          <input type="text" readOnly value={shareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
        </div>
      </div>

      <div className="player-list">
        <h3>PLAYERS ({players.length}/2)</h3>
        {players.map((p) => (
          <div key={p.nickname} className={`player-row ${p.deposited ? "ready" : ""}`}>
            <span className="player-name">
              {p.nickname === nickname ? `> ${p.nickname} (YOU)` : p.nickname}
              {p.index === 0 && players[0]?.nickname === p.nickname && " [HOST]"}
            </span>
            <div className="player-meta">
              {p.walletAddress && (
                <span className="player-wallet">
                  {p.walletAddress.slice(0, 6)}...{p.walletAddress.slice(-4)}
                </span>
              )}
              <span className={`player-status ${p.deposited ? "status-ready" : "status-waiting"}`}>
                {p.deposited ? "DEPOSITED" : "PENDING"}
              </span>
            </div>
          </div>
        ))}
        {players.length < 2 && (
          <div className="player-row empty">
            <span className="player-name">Waiting for opponent...</span>
          </div>
        )}
      </div>

      <div className="entry-fee-info">
        1 USDC ENTRY | $0.10 PER KILL | LAST STANDING WINS
      </div>

      {matchLocked && (
        <div className="match-locked-badge">MATCH LOCKED ON-CHAIN</div>
      )}

      {error && <div className="error-msg">{error}</div>}

      <div className="lobby-actions">
        {/* Deposit button (only if real wallets connected) */}
        {!me?.deposited && players.length === 2 && !isTestMode && (
          <button
            className="btn btn-primary"
            onClick={handleDeposit}
            disabled={depositing}
          >
            {depositing ? "DEPOSITING..." : "DEPOSIT 1 USDC"}
          </button>
        )}

        {/* Start button — creator can start when 2 players are in */}
        {isCreator && players.length >= 1 && (
          <button className="btn btn-primary" onClick={onStartGame}>
            START GAME ({players.length} PLAYER{players.length > 1 ? "S" : ""})
          </button>
        )}

        {/* Waiting for host */}
        {!isCreator && players.length === 2 && (
          <button className="btn btn-secondary" disabled>
            WAITING FOR HOST TO START...
          </button>
        )}

        <button className="btn btn-secondary" onClick={onLeave}>
          LEAVE
        </button>
      </div>
    </div>
  );
}
