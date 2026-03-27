import type { WebSocket } from "ws";
import type { RoomInfo, Player, PlayerInfo } from "./types.js";

const MAX_PLAYERS = 2; // 1v1 mode
const ROOM_CODE_LENGTH = 6;
const ROOM_CLEANUP_MS = 5 * 60 * 1000;
const ENTRY_FEE = 1_000_000; // 1 USDC in micro-USDC

const rooms = new Map<string, RoomInfo>();

function generateRoomId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id: string;
  do {
    id = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(id));
  return id;
}

export function generateMatchId(roomId: string): string {
  // Convert room ID to a felt252-compatible hex string
  let hex = "0x";
  for (let i = 0; i < roomId.length; i++) {
    hex += roomId.charCodeAt(i).toString(16);
  }
  // Append timestamp for uniqueness
  hex += Date.now().toString(16);
  return hex;
}

export function createRoom(nickname: string, ws: WebSocket, walletAddress: string): RoomInfo {
  const id = generateRoomId();
  const matchId = generateMatchId(id);
  const player: Player = { nickname, ready: false, ws, index: 0, walletAddress, deposited: false };
  const room: RoomInfo = {
    id,
    state: "WAITING",
    players: new Map([[nickname, player]]),
    creatorNickname: nickname,
    createdAt: Date.now(),
    gameClients: new Map(),
    matchId,
    matchLocked: false,
    paused: false,
    balances: new Map(),
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(id: string): RoomInfo | undefined {
  return rooms.get(id);
}

export function joinRoom(
  roomId: string,
  nickname: string,
  ws: WebSocket,
  walletAddress: string
): { room: RoomInfo; player: Player } | { error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found" };
  if (room.state !== "WAITING") return { error: "Game already in progress" };
  if (room.players.size >= MAX_PLAYERS) return { error: "Room is full (max 2 players)" };
  if (room.players.has(nickname)) return { error: "Nickname already taken in this room" };

  // Check wallet isn't already in room
  for (const [, p] of room.players) {
    if (p.walletAddress === walletAddress) return { error: "Wallet already in this room" };
  }

  const index = findNextIndex(room);
  const player: Player = { nickname, ready: false, ws, index, walletAddress, deposited: false };
  room.players.set(nickname, player);
  return { room, player };
}

export function removePlayer(room: RoomInfo, nickname: string): boolean {
  room.players.delete(nickname);
  if (room.players.size === 0) {
    rooms.delete(room.id);
    return true;
  }
  if (room.creatorNickname === nickname) {
    const first = room.players.values().next().value!;
    room.creatorNickname = first.nickname;
  }
  return false;
}

export function setDeposited(room: RoomInfo, nickname: string): void {
  const player = room.players.get(nickname);
  if (player) {
    player.deposited = true;
  }
}

export function allDeposited(room: RoomInfo): boolean {
  if (room.players.size < 2) return false;
  for (const [, p] of room.players) {
    if (!p.deposited) return false;
  }
  return true;
}

export function initBalances(room: RoomInfo): void {
  room.balances = new Map();
  for (const [, p] of room.players) {
    if (p.walletAddress) {
      room.balances.set(p.walletAddress, ENTRY_FEE);
    }
  }
}

export function applyKill(room: RoomInfo, killerAddress: string): { killerBal: number; victimBal: number; victimAddress: string } {
  const balances = room.balances!;
  let victimAddress = "";
  for (const [addr] of balances) {
    if (addr !== killerAddress) {
      victimAddress = addr;
      break;
    }
  }

  const bounty = 100_000; // 0.10 USDC
  const victimBal = balances.get(victimAddress) ?? 0;
  const killerBal = balances.get(killerAddress) ?? 0;
  const transfer = Math.min(bounty, victimBal);

  balances.set(killerAddress, killerBal + transfer);
  balances.set(victimAddress, victimBal - transfer);

  return {
    killerBal: killerBal + transfer,
    victimBal: victimBal - transfer,
    victimAddress,
  };
}

export function findPlayerByIndex(room: RoomInfo, index: number): Player | undefined {
  for (const [, p] of room.players) {
    if (p.index === index) return p;
  }
  return undefined;
}

export function findPlayerByWallet(room: RoomInfo, address: string): Player | undefined {
  for (const [, p] of room.players) {
    if (p.walletAddress === address) return p;
  }
  return undefined;
}

export function toggleReady(room: RoomInfo, nickname: string): boolean {
  const player = room.players.get(nickname);
  if (!player) return false;
  player.ready = !player.ready;
  return player.ready;
}

export function canStart(room: RoomInfo, nickname: string): { ok: boolean; error?: string } {
  if (room.creatorNickname !== nickname) return { ok: false, error: "Only the room creator can start" };
  return { ok: true };
}

export function startGame(room: RoomInfo): void {
  room.state = "PLAYING";
  initBalances(room);
}

export function endGame(room: RoomInfo): void {
  room.state = "ENDED";
  setTimeout(() => {
    rooms.delete(room.id);
  }, ROOM_CLEANUP_MS);
}

export function getPlayerInfo(room: RoomInfo): PlayerInfo[] {
  return Array.from(room.players.values()).map((p) => ({
    nickname: p.nickname,
    ready: p.ready,
    index: p.index,
    walletAddress: p.walletAddress,
    deposited: p.deposited,
  }));
}

export function registerGameClient(room: RoomInfo, fromUid: number, ws: WebSocket): void {
  room.gameClients.set(fromUid, ws);
}

export function removeGameClient(room: RoomInfo, fromUid: number): void {
  room.gameClients.delete(fromUid);
  if (room.gameClients.size === 0 && room.state === "PLAYING") {
    endGame(room);
  }
}

function findNextIndex(room: RoomInfo): number {
  const used = new Set(Array.from(room.players.values()).map((p) => p.index));
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!used.has(i)) return i;
  }
  return room.players.size;
}

export function getBalancesRecord(room: RoomInfo): Record<string, number> {
  const result: Record<string, number> = {};
  if (room.balances) {
    for (const [addr, bal] of room.balances) {
      result[addr] = bal;
    }
  }
  return result;
}
