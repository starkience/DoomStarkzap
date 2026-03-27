import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { handleLobbyConnection } from "./lobby.js";
import { handleRelayConnection } from "./relay.js";
import { initStarknet } from "./starknet.js";

const PORT = parseInt(process.env.PORT || "8001", 10);

// Initialize Starknet connection (optional — server works without it for dev)
initStarknet();

const server = createServer((_req, res) => {
  // Health check endpoint
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
});

wss.on("connection", (ws: WebSocket, req) => {
  const url = req.url || "/";
  console.log(`[ws] new connection: ${url}`);

  // Route by URL path
  if (url.startsWith("/lobby/") || url === "/lobby") {
    handleLobbyConnection(ws);
  } else if (url.startsWith("/ws/")) {
    const roomId = url.slice(4); // strip "/ws/"
    handleRelayConnection(ws, roomId);
  } else {
    console.log(`[ws] unknown path: ${url}`);
    ws.close(1008, "Unknown path");
  }
});

server.listen(PORT, () => {
  console.log(`[server] DoomStarkzap relay listening on port ${PORT}`);
  console.log(`[server] Lobby: ws://localhost:${PORT}/lobby`);
  console.log(`[server] Relay: ws://localhost:${PORT}/ws/{roomId}`);
});
