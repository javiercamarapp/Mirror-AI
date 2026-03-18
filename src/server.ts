import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { validateToken } from "./auth.js";
import { ClaudeBridge, ClaudeMessage } from "./claude-bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export function createAppServer(authToken: string, port: number) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const claude = new ClaudeBridge();
  const history: ChatMessage[] = [];
  let activeClient: WebSocket | null = null;

  // Serve static files
  app.use(express.static(join(__dirname, "..", "public")));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", busy: claude.busy });
  });

  // WebSocket upgrade with auth
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token || !validateToken(token, authToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // WebSocket connection handler
  wss.on("connection", (ws) => {
    console.log("[ws] Client connected");
    activeClient = ws;

    // Send current state
    ws.send(JSON.stringify({
      type: "init",
      history,
      status: claude.busy ? "busy" : "ready",
    }));

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "prompt") {
          const userMsg: ChatMessage = {
            role: "user",
            content: msg.text,
            timestamp: Date.now(),
          };
          history.push(userMsg);
          broadcast({ type: "chat", message: userMsg });

          // Start new assistant message
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: "",
            timestamp: Date.now(),
          };
          history.push(assistantMsg);

          claude.sendPrompt(msg.text);
        }

        if (msg.type === "abort") {
          claude.abort();
        }
      } catch (err) {
        console.error("[ws] Bad message:", err);
      }
    });

    ws.on("close", () => {
      console.log("[ws] Client disconnected");
      if (activeClient === ws) activeClient = null;
    });
  });

  // Claude bridge events
  claude.on("message", (msg: ClaudeMessage) => {
    // Accumulate assistant text
    if (msg.type === "assistant" && msg.subtype === "text" && msg.content) {
      const lastAssistant = [...history].reverse().find(m => m.role === "assistant");
      if (lastAssistant) {
        lastAssistant.content += msg.content;
      }
    }

    broadcast({ type: "claude", data: msg });
  });

  claude.on("status", (status: string) => {
    broadcast({ type: "status", status });
  });

  claude.on("done", () => {
    broadcast({ type: "done" });
  });

  claude.on("error", (err: Error) => {
    broadcast({ type: "error", message: err.message });
  });

  claude.on("log", (text: string) => {
    broadcast({ type: "log", text });
  });

  function broadcast(data: unknown) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  function start(): Promise<void> {
    return new Promise((resolve) => {
      server.listen(port, () => resolve());
    });
  }

  function stop(): Promise<void> {
    claude.destroy();
    return new Promise((resolve) => {
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  }

  return { app, server, start, stop };
}
