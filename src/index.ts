import { generateToken } from "./auth.js";
import { createAppServer } from "./server.js";
import { createTunnel } from "./tunnel.js";
import qrcode from "qrcode-terminal";

const PORT = parseInt(process.env.PORT || "3777", 10);
const SKIP_TUNNEL = process.env.SKIP_TUNNEL === "1";

async function main() {
  const token = generateToken();

  console.log("\n  Mirror-AI — Remote Mobile Control for Claude Code\n");

  // Start server
  const server = createAppServer(token, PORT);
  await server.start();
  console.log(`  [server] Running on http://localhost:${PORT}`);

  let publicUrl: string;
  let closeTunnel: (() => void) | undefined;

  if (SKIP_TUNNEL) {
    publicUrl = `http://localhost:${PORT}`;
    console.log("  [tunnel] Skipped (SKIP_TUNNEL=1)");
  } else {
    try {
      console.log("  [tunnel] Connecting...");
      const tunnel = await createTunnel(PORT);
      publicUrl = tunnel.url;
      closeTunnel = tunnel.close;
      console.log(`  [tunnel] ${publicUrl}`);
    } catch (err) {
      console.error("  [tunnel] Failed, using localhost:", (err as Error).message);
      publicUrl = `http://localhost:${PORT}`;
    }
  }

  const fullUrl = `${publicUrl}?token=${token}`;

  // Print QR code
  console.log("\n  Scan this QR code from your phone:\n");
  qrcode.generate(fullUrl, { small: true }, (qr: string) => {
    const indented = qr.split("\n").map(line => "  " + line).join("\n");
    console.log(indented);
  });

  console.log(`\n  Or open this URL:\n  ${fullUrl}\n`);
  console.log("  Waiting for connection...\n");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n  Shutting down...");
    closeTunnel?.();
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
