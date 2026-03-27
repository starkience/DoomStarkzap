import type { WebSocket } from "ws";
import { getRoom, removeGameClient } from "./room.js";

interface DoomSocket extends WebSocket {
  from?: number;
  gameId?: string;
}

// Per-room packet buffer for pause state
const pauseBuffers = new Map<string, Array<{ to: number; payload: Buffer }>>();

/**
 * Pause the relay for a room. Packets are buffered instead of forwarded.
 * Doom's lockstep model means both clients freeze naturally.
 */
export function pauseRelay(roomId: string): void {
  pauseBuffers.set(roomId, []);
  console.log(`[relay] PAUSED room ${roomId}`);
}

/**
 * Resume the relay. Flush all buffered packets then continue normal forwarding.
 */
export function resumeRelay(roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  const buffer = pauseBuffers.get(roomId);
  if (buffer) {
    for (const pkt of buffer) {
      for (const [uid, client] of room.gameClients) {
        if (uid === pkt.to && client.readyState === 1 /* OPEN */) {
          client.send(pkt.payload);
          break;
        }
      }
    }
    console.log(`[relay] RESUMED room ${roomId}, flushed ${buffer.length} packets`);
    pauseBuffers.delete(roomId);
  }
}

export function isRelayPaused(roomId: string): boolean {
  return pauseBuffers.has(roomId);
}

/**
 * Binary packet relay for Doom multiplayer.
 * Protocol: bytes 0-3 = dest IP (uint32 LE), bytes 4-7 = source UID, bytes 8+ = payload
 * Relay strips dest (0-3) and forwards bytes 4+ to matching client.
 */
export function handleRelayConnection(ws: DoomSocket, roomId: string): void {
  const room = getRoom(roomId);
  if (!room || room.state !== "PLAYING") {
    ws.close(1008, "Room not found or not in PLAYING state");
    return;
  }

  ws.gameId = roomId;
  const clients = room.gameClients;

  ws.on("message", (data: Buffer) => {
    if (ws.from === undefined) {
      ws.from = data.readUInt32LE(4);
      clients.set(ws.from, ws);
      console.log(`[relay] player UID ${ws.from} connected to room ${roomId}`);
    }

    const to = data.readUInt32LE(0);
    const payload = data.slice(4);

    // If room is paused, buffer the packet instead of forwarding
    const buffer = pauseBuffers.get(roomId);
    if (buffer) {
      buffer.push({ to, payload });
      return;
    }

    // Normal forwarding
    for (const [uid, client] of clients) {
      if (uid === to && client.readyState === 1 /* OPEN */) {
        client.send(payload);
        break;
      }
    }
  });

  ws.on("close", () => {
    if (ws.from !== undefined) {
      console.log(`[relay] player UID ${ws.from} disconnected from room ${roomId}`);
      removeGameClient(room, ws.from);
    }
  });

  ws.on("error", (err) => {
    console.error(`[relay] error in room ${roomId}:`, err.message);
  });
}
