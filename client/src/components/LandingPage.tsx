import { useState, useEffect } from "react";

interface Props {
  onCreateRoom: (nickname: string, walletAddress: string) => void;
  onJoinRoom: (roomId: string, nickname: string, walletAddress: string) => void;
  error: string | null;
  walletAddress: string | null;
  truncatedAddress: string | null;
  walletConnecting: boolean;
  walletBalance: string | null;
  onConnectWallet: () => void;
  onSkipWallet: () => void;
}

const ADJECTIVES = [
  "Grumpy", "Ecstatic", "Crafty", "Alert", "Hostile", "Furious",
  "Patient", "Manic", "Sporty", "Scary", "Tired", "Aggressive",
];

const NOUNS = [
  "Cacodemon", "Cyberdemon", "Imp", "Demon", "Mancubus",
  "Revenant", "Baron", "Knight", "Spectre", "Arachnotron",
];

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

export function LandingPage({
  onCreateRoom,
  onJoinRoom,
  error,
  walletAddress,
  truncatedAddress,
  walletConnecting,
  walletBalance,
  onConnectWallet,
  onSkipWallet,
}: Props) {
  const [nickname, setNickname] = useState(randomName());
  const [mode, setMode] = useState<"menu" | "join">("menu");
  const [roomCode, setRoomCode] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      setRoomCode(room.toUpperCase());
      setMode("join");
    }
  }, []);

  const effectiveAddress = walletAddress || "0x0";
  const canAct = !!nickname.trim();

  return (
    <div className="landing">
      <div className="logo">
        <h1 className="title">DOOM</h1>
        <h2 className="subtitle">STARKZAP</h2>
        <p className="tagline">PAY2PLAY KILL2EARN</p>
      </div>

      {/* Wallet Connection */}
      {!walletAddress ? (
        <div className="wallet-buttons">
          <button
            className="btn btn-primary"
            onClick={onConnectWallet}
            disabled={walletConnecting}
            style={{ width: "100%" }}
          >
            {walletConnecting ? "CONNECTING..." : "CONNECT WALLET"}
          </button>
          <button
            className="btn btn-secondary"
            onClick={onSkipWallet}
            style={{ width: "100%", fontSize: "0.5rem" }}
          >
            PLAY WITHOUT WALLET (TEST MODE)
          </button>
        </div>
      ) : (
        <div className="wallet-info">
          <span className="wallet-address">{truncatedAddress}</span>
          {walletBalance && <span className="wallet-balance">{walletBalance}</span>}
        </div>
      )}

      <div className="form-group">
        <label>YOUR NAME</label>
        <div className="name-input">
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value.replace(/[^0-9a-zA-Z \-!]/g, ""))}
            maxLength={20}
            placeholder="Enter your name"
          />
          <button className="btn-small" onClick={() => setNickname(randomName())}>
            &#x21bb;
          </button>
        </div>
      </div>

      <div className="entry-fee-info">
        ENTRY FEE: 1 USDC | BOUNTY: $0.10/KILL
      </div>

      {error && <div className="error-msg">{error}</div>}

      {mode === "menu" ? (
        <div className="buttons">
          <button
            className="btn btn-primary"
            onClick={() => canAct && onCreateRoom(nickname.trim(), effectiveAddress)}
            disabled={!canAct}
          >
            CREATE ROOM
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setMode("join")}
            disabled={!canAct}
          >
            JOIN ROOM
          </button>
        </div>
      ) : (
        <div className="join-form">
          <div className="form-group">
            <label>ROOM CODE</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              maxLength={6}
              placeholder="ABCD23"
              autoFocus
            />
          </div>
          <div className="buttons">
            <button
              className="btn btn-primary"
              onClick={() =>
                roomCode.length === 6 && canAct && onJoinRoom(roomCode, nickname.trim(), effectiveAddress)
              }
              disabled={roomCode.length !== 6 || !canAct}
            >
              JOIN
            </button>
            <button className="btn btn-secondary" onClick={() => setMode("menu")}>
              BACK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
