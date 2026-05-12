console.error(
  [
    "scripts/vouch.ts is retired.",
    "The active AgentVouch v0.2.0 vouch flow is USDC-native and requires SPL token accounts, not SOL stake lamports.",
    "",
    "Use the web app, generated client, or scripts/devnet-usdc-smoke.mjs for USDC vouch smoke flows.",
    "For full protocol validation:",
    "  npm run smoke:devnet-usdc",
  ].join("\n")
);

process.exit(1);
