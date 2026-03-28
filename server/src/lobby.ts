import type { WebSocket } from "ws";
import type { LobbyClientMsg, LobbyServerMsg } from "./types.js";
import {
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  toggleReady,
  canStart,
  startGame,
  endGame,
  getPlayerInfo,
  setDeposited,
  allDeposited,
  applyKill,
  findPlayerByIndex,
  getBalancesRecord,
} from "./room.js";
import { pauseRelay, resumeRelay } from "./relay.js";
import {
  isStarknetReady,
  createMatch as createMatchOnChain,
  lockMatch as lockMatchOnChain,
  recordKill as recordKillOnChain,
  settleMatch as settleMatchOnChain,
  waitForTx,
} from "./starknet.js";

const wsToRoom = new Map<WebSocket, { roomId: string; nickname: string }>();

function send(ws: WebSocket, msg: LobbyServerMsg): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(roomId: string, msg: LobbyServerMsg, exclude?: WebSocket): void {
  const room = getRoom(roomId);
  if (!room) return;
  for (const [, player] of room.players) {
    if (player.ws !== exclude) {
      send(player.ws, msg);
    }
  }
}

export function handleLobbyConnection(ws: WebSocket): void {
  ws.on("message", (data) => {
    let msg: LobbyClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send(ws, { type: "ERROR", message: "Invalid JSON" });
      return;
    }
    handleMessage(ws, msg);
  });

  ws.on("close", () => {
    const info = wsToRoom.get(ws);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (room && room.state === "WAITING") {
      removePlayer(room, info.nickname);
      broadcast(info.roomId, { type: "PLAYER_LEFT", nickname: info.nickname });
    }
    wsToRoom.delete(ws);
  });
}

async function handleMessage(ws: WebSocket, msg: LobbyClientMsg): Promise<void> {
  switch (msg.type) {
    case "CREATE_ROOM": {
      const nickname = msg.nickname.trim();
      if (!nickname || nickname.length > 20) {
        send(ws, { type: "ERROR", message: "Invalid nickname" });
        return;
      }
      const room = createRoom(nickname, ws, msg.walletAddress);

      wsToRoom.set(ws, { roomId: room.id, nickname });
      send(ws, {
        type: "ROOM_CREATED",
        roomId: room.id,
        players: getPlayerInfo(room),
        matchId: room.matchId!,
      });
      break;
    }

    case "JOIN_ROOM": {
      const nickname = msg.nickname.trim();
      const roomId = msg.roomId.trim().toUpperCase();
      if (!nickname || nickname.length > 20) {
        send(ws, { type: "ERROR", message: "Invalid nickname" });
        return;
      }
      const result = joinRoom(roomId, nickname, ws, msg.walletAddress);
      if ("error" in result) {
        send(ws, { type: "ERROR", message: result.error });
        return;
      }
      wsToRoom.set(ws, { roomId, nickname });
      send(ws, {
        type: "ROOM_JOINED",
        roomId,
        players: getPlayerInfo(result.room),
        yourIndex: result.player.index,
        matchId: result.room.matchId!,
      });
      broadcast(roomId, {
        type: "PLAYER_JOINED",
        player: {
          nickname: result.player.nickname,
          ready: result.player.ready,
          index: result.player.index,
          walletAddress: result.player.walletAddress,
          deposited: result.player.deposited,
        },
      }, ws);
      break;
    }

    case "TOGGLE_READY": {
      const info = wsToRoom.get(ws);
      if (!info) return;
      const room = getRoom(info.roomId);
      if (!room || room.state !== "WAITING") return;
      const ready = toggleReady(room, info.nickname);
      broadcast(info.roomId, {
        type: "PLAYER_READY",
        nickname: info.nickname,
        ready,
      });
      break;
    }

    case "DEPOSIT_CONFIRMED": {
      const info = wsToRoom.get(ws);
      if (!info) return;
      const room = getRoom(info.roomId);
      if (!room || room.state !== "WAITING") return;

      // Mark player as deposited
      setDeposited(room, info.nickname);
      broadcast(info.roomId, {
        type: "DEPOSIT_STATUS",
        nickname: info.nickname,
        deposited: true,
      });

      // If both deposited, lock match on-chain
      if (allDeposited(room) && !room.matchLocked) {
        if (isStarknetReady() && room.matchId) {
          try {
            const txHash = await lockMatchOnChain(room.matchId);
            await waitForTx(txHash);
            room.matchLocked = true;
            broadcast(info.roomId, { type: "MATCH_LOCKED" });
            console.log(`[lobby] Match ${room.matchId} locked on-chain`);
          } catch (err) {
            console.error("[lobby] Failed to lock match on-chain:", err);
            send(ws, { type: "ERROR", message: "Failed to lock match on-chain" });
          }
        } else {
          // If starknet not configured, auto-lock for dev/testing
          room.matchLocked = true;
          broadcast(info.roomId, { type: "MATCH_LOCKED" });
        }
      }
      break;
    }

    case "START_GAME": {
      const info = wsToRoom.get(ws);
      if (!info) return;
      const room = getRoom(info.roomId);
      if (!room) return;
      const check = canStart(room, info.nickname);
      if (!check.ok) {
        send(ws, { type: "ERROR", message: check.error! });
        return;
      }
      startGame(room);
      for (const [, player] of room.players) {
        send(player.ws, {
          type: "GAME_STARTING",
          wsPath: `/ws/${room.id}`,
          playerIndex: player.index,
          playerCount: room.players.size,
        });
      }
      break;
    }

    case "KILL_DETECTED": {
      const info = wsToRoom.get(ws);
      if (!info) return;
      const room = getRoom(info.roomId);
      if (!room || room.state !== "PLAYING" || room.paused) return;

      // Validate: only the killer's client should report
      const reporter = room.players.get(info.nickname);
      if (!reporter || reporter.index !== msg.killerIndex) return;

      const killer = findPlayerByIndex(room, msg.killerIndex);
      const victim = findPlayerByIndex(room, msg.victimIndex);
      if (!killer?.walletAddress || !victim?.walletAddress) return;

      // 1. Pause relay — game freezes
      room.paused = true;
      pauseRelay(room.id);
      broadcast(info.roomId, { type: "GAME_PAUSED", reason: "PROCESSING BOUNTY..." });

      try {
        // 2. Call record_kill on-chain
        if (isStarknetReady() && room.matchId) {
          const txHash = await recordKillOnChain(room.matchId, killer.walletAddress);
          await waitForTx(txHash);
        }

        // 3. Update local balance cache
        const { killerBal, victimBal } = applyKill(room, killer.walletAddress);

        broadcast(info.roomId, {
          type: "KILL_CONFIRMED",
          killer: killer.nickname,
          victim: victim.nickname,
          killerBalance: killerBal,
          victimBalance: victimBal,
        });

        // 4. Check if match should end
        if (victimBal <= 0) {
          if (isStarknetReady() && room.matchId) {
            try {
              const txHash = await settleMatchOnChain(room.matchId);
              await waitForTx(txHash);
            } catch (err) {
              console.error("[lobby] settle failed:", err);
            }
          }
          broadcast(info.roomId, {
            type: "MATCH_ENDED",
            winner: killer.nickname,
            balances: getBalancesRecord(room),
          });
          endGame(room);
          return;
        }

        // 5. Resume relay — game unfreezes
        room.paused = false;
        resumeRelay(room.id);
        broadcast(info.roomId, { type: "GAME_RESUMED" });
      } catch (err) {
        // On failure, resume anyway to not permanently freeze game
        console.error("[lobby] kill processing failed:", err);
        room.paused = false;
        resumeRelay(room.id);
        broadcast(info.roomId, { type: "GAME_RESUMED" });
      }
      break;
    }

    case "LEAVE_ROOM": {
      const info = wsToRoom.get(ws);
      if (!info) return;
      const room = getRoom(info.roomId);
      if (room) {
        // If game is playing and player leaves, settle the match
        if (room.state === "PLAYING" && isStarknetReady() && room.matchId) {
          try {
            await settleMatchOnChain(room.matchId);
          } catch (err) {
            console.error("[lobby] settle on leave failed:", err);
          }
        }
        removePlayer(room, info.nickname);
        broadcast(info.roomId, { type: "PLAYER_LEFT", nickname: info.nickname });
      }
      wsToRoom.delete(ws);
      break;
    }
  }
}
