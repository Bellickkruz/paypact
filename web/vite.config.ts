import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// In development, serve /api/relay from the same handler Vercel runs in production.
function devRelay(): Plugin {
  return {
    name: "paypact-dev-relay",
    configureServer(server) {
      server.middlewares.use("/api/relay", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        let body: unknown = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || "null");
        } catch {
          body = null;
        }
        const { handleRelay } = await server.ssrLoadModule("/api/relay.ts");
        const response: Response = await handleRelay(body);
        res.statusCode = response.status;
        res.setHeader("content-type", "application/json");
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), devRelay()] };
});
