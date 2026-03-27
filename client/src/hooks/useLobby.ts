import { useState, useRef, useCallback, useEffect } from "react";
import type { PlayerInfo, LobbyClientMsg, LobbyServerMsg } from "../lib/lobby-protocol";

const WS_BASE = import.meta.env.VITE_WS_URL || "";

export interface GameStartInfo {
  wsPath: string;
  playerIndex: number;
  playerCount: number;
}

export interface MatchResult {
  winner: string;
  balances: Record<string, number>;
}

export function useLobby() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [gameInfo, setGameInfo] = useState<GameStartInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const [matchLocked, setMatchLocked] = useState(false);

  // Game-time state
  const [gamePaused, setGamePaused] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((msg: LobbyClientMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    let wsUrl: string;
    if (WS_BASE) {
      wsUrl = `${WS_BASE}/lobby`;
    } else {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${proto}//${window.location.host}/lobby`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      const msg: LobbyServerMsg = JSON.parse(event.data);
      handleMessage(msg);
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("Connection lost. Please refresh.");
  }, []);

  const handleMessage = useCallback((msg: LobbyServerMsg) => {
    switch (msg.type) {
      case "ROOM_CREATED":
        setRoomId(msg.roomId);
        setMatchId(msg.matchId);
        setPlayers(msg.players);
        break;
      case "ROOM_JOINED":
        setRoomId(msg.roomId);
        setMatchId(msg.matchId);
        setPlayers(msg.players);
        break;
      case "PLAYER_JOINED":
        setPlayers((prev) => [...prev, msg.player]);
        break;
      case "PLAYER_LEFT":
        setPlayers((prev) => prev.filter((p) => p.nickname !== msg.nickname));
        break;
      case "PLAYER_READY":
        setPlayers((prev) =>
          prev.map((p) => (p.nickname === msg.nickname ? { ...p, ready: msg.ready } : p))
        );
        break;
      case "DEPOSIT_STATUS":
        setPlayers((prev) =>
          prev.map((p) => (p.nickname === msg.nickname ? { ...p, deposited: msg.deposited } : p))
        );
        break;
      case "MATCH_LOCKED":
        setMatchLocked(true);
        break;
      case "GAME_STARTING":
        setGameInfo({
          wsPath: msg.wsPath,
          playerIndex: msg.playerIndex,
          playerCount: msg.playerCount,
        });
        break;
      case "GAME_PAUSED":
        setGamePaused(true);
        setPauseReason(msg.reason);
        break;
      case "GAME_RESUMED":
        setGamePaused(false);
        setPauseReason("");
        break;
      case "KILL_CONFIRMED":
        setBalances({
          [msg.killer]: msg.killerBalance,
          [msg.victim]: msg.victimBalance,
        });
        break;
      case "MATCH_ENDED":
        setMatchResult({ winner: msg.winner, balances: msg.balances });
        break;
      case "ERROR":
        setError(msg.message);
        break;
    }
  }, []);

  const createRoom = useCallback(
    (nick: string, walletAddress: string) => {
      setNickname(nick);
      setError(null);
      connect();
      const check = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(check);
          send({ type: "CREATE_ROOM", nickname: nick, walletAddress });
        }
      }, 50);
    },
    [connect, send]
  );

  const joinRoom = useCallback(
    (code: string, nick: string, walletAddress: string) => {
      setNickname(nick);
      setError(null);
      connect();
      const check = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(check);
          send({ type: "JOIN_ROOM", roomId: code, nickname: nick, walletAddress });
        }
      }, 50);
    },
    [connect, send]
  );

  const toggleReady = useCallback(() => send({ type: "TOGGLE_READY" }), [send]);
  const startGame = useCallback(() => send({ type: "START_GAME" }), [send]);
  const confirmDeposit = useCallback((txHash: string) => send({ type: "DEPOSIT_CONFIRMED", txHash }), [send]);
  const reportKill = useCallback(
    (killerIndex: number, victimIndex: number) =>
      send({ type: "KILL_DETECTED", killerIndex, victimIndex }),
    [send]
  );

  const leaveRoom = useCallback(() => {
    send({ type: "LEAVE_ROOM" });
    wsRef.current?.close();
    setRoomId(null);
    setMatchId(null);
    setPlayers([]);
    setGameInfo(null);
    setNickname(null);
    setMatchLocked(false);
    setMatchResult(null);
  }, [send]);

  useEffect(() => {
    return () => { wsRef.current?.close(); };
  }, []);

  return {
    roomId,
    matchId,
    players,
    gameInfo,
    error,
    connected,
    nickname,
    matchLocked,
    gamePaused,
    pauseReason,
    balances,
    matchResult,
    createRoom,
    joinRoom,
    toggleReady,
    startGame,
    confirmDeposit,
    reportKill,
    leaveRoom,
  };
}
