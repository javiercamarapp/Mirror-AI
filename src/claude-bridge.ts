import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface ClaudeMessage {
  type: string;
  subtype?: string;
  content?: string;
  tool_name?: string;
  session_id?: string;
  [key: string]: unknown;
}

export class ClaudeBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = "";
  private _busy = false;
  private sessionId: string | null = null;

  get busy(): boolean {
    return this._busy;
  }

  async sendPrompt(text: string): Promise<void> {
    if (this._busy) {
      this.emit("error", new Error("Claude is busy processing a prompt"));
      return;
    }

    this._busy = true;
    this.emit("status", "busy");
    this.buffer = "";

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
    ];

    // Resume session if we have one
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    args.push(text);

    this.process = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: ClaudeMessage = JSON.parse(line);

          // Capture session ID from init message
          if (msg.type === "system" && msg.session_id) {
            this.sessionId = msg.session_id as string;
          }

          this.emit("message", msg);
        } catch {
          // Non-JSON output, emit as raw text
          this.emit("message", {
            type: "assistant",
            subtype: "text",
            content: line,
          });
        }
      }
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        this.emit("log", text);
      }
    });

    this.process.on("close", (code) => {
      this._busy = false;
      this.process = null;
      this.emit("status", "ready");
      this.emit("done", code);
    });

    this.process.on("error", (err) => {
      this._busy = false;
      this.process = null;
      this.emit("status", "error");
      this.emit("error", err);
    });
  }

  abort(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this._busy = false;
      this.emit("status", "ready");
    }
  }

  destroy(): void {
    this.abort();
    this.removeAllListeners();
  }
}
