import type { WebSocket } from "ws";

export interface Player {
  nickname: string;
  ready: boolean;
  ws: WebSocket;
  index: number; // 0 or 1 for 1v1
  walletAddress?: string;
  deposited?: boolean;
}

export type RoomState = "WAITING" | "PLAYING" | "ENDED";

export interface RoomInfo {
  id: string;
  state: RoomState;
  players: Map<string, Player>;
  creatorNickname: string;
  createdAt: number;
  gameClients: Map<number, WebSocket>;
  // Pay2Play fields
  matchId?: string;
  matchLocked?: boolean;
  paused?: boolean;
  balances?: Map<string, number>; // walletAddress -> balance in micro-USDC
}

export interface PlayerInfo {
  nickname: string;
  ready: boolean;
  index: number;
  walletAddress?: string;
  deposited?: boolean;
}

// Client -> Server lobby messages
export type LobbyClientMsg =
  | { type: "CREATE_ROOM"; nickname: string; walletAddress: string }
  | { type: "JOIN_ROOM"; roomId: string; nickname: string; walletAddress: string }
  | { type: "TOGGLE_READY" }
  | { type: "START_GAME" }
  | { type: "LEAVE_ROOM" }
  | { type: "DEPOSIT_CONFIRMED"; txHash: string }
  | { type: "KILL_DETECTED"; killerIndex: number; victimIndex: number }
  | { type: "WITHDRAW_REQUEST" };

// Server -> Client lobby messages
export type LobbyServerMsg =
  | { type: "ROOM_CREATED"; roomId: string; players: PlayerInfo[]; matchId: string }
  | { type: "ROOM_JOINED"; roomId: string; players: PlayerInfo[]; yourIndex: number; matchId: string }
  | { type: "PLAYER_JOINED"; player: PlayerInfo }
  | { type: "PLAYER_LEFT"; nickname: string }
  | { type: "PLAYER_READY"; nickname: string; ready: boolean }
  | { type: "DEPOSIT_STATUS"; nickname: string; deposited: boolean }
  | { type: "MATCH_LOCKED" }
  | { type: "GAME_STARTING"; wsPath: string; playerIndex: number; playerCount: number }
  | { type: "GAME_PAUSED"; reason: string }
  | { type: "GAME_RESUMED" }
  | { type: "KILL_CONFIRMED"; killer: string; victim: string; killerBalance: number; victimBalance: number }
  | { type: "MATCH_ENDED"; winner: string; balances: Record<string, number> }
  | { type: "ERROR"; message: string };
