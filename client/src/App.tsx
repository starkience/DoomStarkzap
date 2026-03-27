import { useCallback } from "react";
import { LandingPage } from "./components/LandingPage";
import { Lobby } from "./components/Lobby";
import { GameScreen } from "./components/GameScreen";
import { useLobby } from "./hooks/useLobby";
import { useWallet } from "./hooks/useWallet";

type Screen = "landing" | "lobby" | "game";

function getScreen(roomId: string | null, gameInfo: unknown): Screen {
  if (gameInfo) return "game";
  if (roomId) return "lobby";
  return "landing";
}

export default function App() {
  const lobby = useLobby();
  const wallet = useWallet();
  const screen = getScreen(lobby.roomId, lobby.gameInfo);

  const handleWithdraw = useCallback(async () => {
    if (lobby.matchId) {
      await wallet.withdraw(lobby.matchId);
    }
  }, [lobby.matchId, wallet]);

  // Map balances from wallet addresses to nicknames for display
  const nicknameBalances: Record<string, number> = {};
  for (const player of lobby.players) {
    if (player.walletAddress && lobby.balances[player.walletAddress] !== undefined) {
      nicknameBalances[player.nickname] = lobby.balances[player.walletAddress];
    }
  }

  // Map match result balances to nicknames
  let nicknameMatchResult = lobby.matchResult;
  if (nicknameMatchResult) {
    const mapped: Record<string, number> = {};
    for (const player of lobby.players) {
      if (player.walletAddress && nicknameMatchResult.balances[player.walletAddress] !== undefined) {
        mapped[player.nickname] = nicknameMatchResult.balances[player.walletAddress];
      }
    }
    // Find winner nickname
    let winnerNick = nicknameMatchResult.winner;
    for (const player of lobby.players) {
      if (player.nickname === nicknameMatchResult.winner || player.walletAddress === nicknameMatchResult.winner) {
        winnerNick = player.nickname;
        break;
      }
    }
    nicknameMatchResult = { winner: winnerNick, balances: mapped };
  }

  const handleSkipWallet = useCallback(() => {
    // Test mode: generate a dummy address so gameplay works without a real wallet
    const dummy = "0x" + Math.random().toString(16).slice(2, 18);
    wallet.setTestAddress(dummy);
  }, [wallet]);

  return (
    <div className="app">
      {screen === "landing" && (
        <LandingPage
          onCreateRoom={lobby.createRoom}
          onJoinRoom={lobby.joinRoom}
          error={lobby.error || wallet.error}
          walletAddress={wallet.address}
          truncatedAddress={wallet.truncatedAddress}
          walletConnecting={wallet.connecting}
          walletBalance={wallet.balance}
          onConnectWallet={wallet.connect}
          onSkipWallet={handleSkipWallet}
        />
      )}
      {screen === "lobby" && lobby.roomId && lobby.nickname && lobby.matchId && (
        <Lobby
          roomId={lobby.roomId}
          matchId={lobby.matchId}
          players={lobby.players}
          nickname={lobby.nickname}
          matchLocked={lobby.matchLocked}
          onToggleReady={lobby.toggleReady}
          onStartGame={lobby.startGame}
          onLeave={lobby.leaveRoom}
          onDeposit={wallet.deposit}
          onConfirmDeposit={lobby.confirmDeposit}
          error={lobby.error}
        />
      )}
      {screen === "game" && lobby.gameInfo && lobby.nickname && (
        <GameScreen
          wsPath={lobby.gameInfo.wsPath}
          playerIndex={lobby.gameInfo.playerIndex}
          playerCount={lobby.gameInfo.playerCount}
          nickname={lobby.nickname}
          gamePaused={lobby.gamePaused}
          pauseReason={lobby.pauseReason}
          balances={nicknameBalances}
          matchResult={nicknameMatchResult}
          onReportKill={lobby.reportKill}
          onWithdraw={handleWithdraw}
        />
      )}
    </div>
  );
}
