console.error(
  [
    "scripts/init-config.ts is retired.",
    "The active AgentVouch v0.2.0 config is USDC-native and must be initialized with scripts/init-agentvouch-config.ts.",
    "",
    "Dry run:",
    "  NO_DNA=1 anchor run init-agentvouch-config",
    "",
    "Apply after verifying the printed config and simulation:",
    "  INIT_AGENTVOUCH_CONFIG_APPLY=1 NO_DNA=1 anchor run init-agentvouch-config",
  ].join("\n")
);

process.exit(1);
