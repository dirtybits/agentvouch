import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Isolated client-only POC UI. Talks to a Base Sepolia read RPC + a CDP
// bundler/paymaster; no server. Kept on its own port (5173) so it never
// collides with the Solana web app (localhost:3000).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
