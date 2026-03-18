import localtunnel from "localtunnel";

export async function createTunnel(port: number): Promise<{
  url: string;
  close: () => void;
}> {
  const tunnel = await localtunnel({ port });

  tunnel.on("error", (err: Error) => {
    console.error("[tunnel] Error:", err.message);
  });

  tunnel.on("close", () => {
    console.log("[tunnel] Closed. Attempting reconnect...");
    setTimeout(() => createTunnel(port), 3000);
  });

  return {
    url: tunnel.url,
    close: () => tunnel.close(),
  };
}
