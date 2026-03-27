import { eventBus } from "./event-bus";

export interface DoomConfig {
  canvas: HTMLCanvasElement;
  wsUrl: string;
  isServer: boolean;
  playerCount: number;
}

declare global {
  interface Window {
    Module: Record<string, unknown>;
    callMain: (args: string[]) => void;
  }
}

/**
 * Initialize the Emscripten Module and load the WASM binary.
 * Must be called AFTER the canvas element is in the DOM.
 */
export function initDoom(config: DoomConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    window.Module = {
      canvas: config.canvas,
      noInitialRun: true,
      preRun: () => {
        const FS = (window.Module as Record<string, unknown>).FS as {
          createPreloadedFile: (
            parent: string,
            name: string,
            url: string,
            canRead: boolean,
            canWrite: boolean
          ) => void;
        };
        FS.createPreloadedFile("", "doom1.wad", "doom1.wad", true, true);
        FS.createPreloadedFile("", "default.cfg", "default.cfg", true, true);
      },
      onRuntimeInitialized: () => {
        resolve();
      },
      print: (text: string) => {
        console.log("[DOOM]", text);
        if (text.startsWith("doom: ")) {
          parseDoomMessage(text.slice(6));
        }
      },
      printErr: (text: string) => {
        console.error("[DOOM]", text);
      },
      setStatus: (text: string) => {
        if (text) console.log("[DOOM status]", text);
      },
      totalDependencies: 0,
      monitorRunDependencies: function (this: { totalDependencies: number }, left: number) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
      },
    };

    // Handle WebGL context loss
    config.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      eventBus.emit("doom:error", "WebGL context lost");
    });

    // Dynamically load the Emscripten JS
    const script = document.createElement("script");
    script.src = "/websockets-doom.js";
    script.onerror = () => reject(new Error("Failed to load websockets-doom.js"));
    document.body.appendChild(script);
  });
}

/**
 * Start the Doom game with multiplayer arguments.
 */
export function startDoomGame(config: DoomConfig): void {
  const args = [
    "-iwad", "doom1.wad",
    "-window",
    "-nogui",
    "-nomusic",
    "-config", "default.cfg",
    "-servername", "doomstarkzap",
    "-nodes", String(config.playerCount),
    "-deathmatch",
    "-privateserver",
    "-dup", "1",
    "-wss", config.wsUrl,
  ];

  if (config.isServer) {
    args.push("-server");
  } else {
    args.push("-connect", "1");
  }

  console.log("[DOOM] callMain args:", args);
  window.callMain(args);
}

function parseDoomMessage(raw: string): void {
  const [idStr, ...rest] = raw.split(",");
  const id = parseInt(idStr, 10);
  const msg = rest.join(",").trim();

  // Log ALL doom messages for kill detection investigation
  console.log(`[DOOM MSG] id=${id} msg="${msg}" raw="${raw}"`);

  switch (id) {
    case 2:
      eventBus.emit("doom:status", "Waiting for other players...");
      break;
    case 5:
      // Likely kill/frag event — parse killer and victim indices
      // Format TBD from investigation, expected: "killerIndex,victimIndex" or "killerIndex"
      {
        const parts = msg.split(",").map((s) => parseInt(s.trim(), 10));
        const killer = parts[0] ?? -1;
        const victim = parts.length > 1 ? parts[1] : -1;
        console.log(`[DOOM KILL?] id=5 killer=${killer} victim=${victim}`);
        eventBus.emit("doom:kill", { killer, victim });
      }
      break;
    case 8:
      // Possibly frag count update
      console.log(`[DOOM FRAG?] id=8 msg="${msg}"`);
      eventBus.emit("doom:frag", msg);
      break;
    case 9:
      eventBus.emit("doom:ended", msg);
      break;
    case 10:
      eventBus.emit("doom:started", msg);
      break;
    default:
      if (msg) eventBus.emit("doom:status", msg);
      break;
  }
}
