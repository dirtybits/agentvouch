# Openfort MCP Setup (per-machine)

The Openfort CLI is wired as an MCP server for AgentVouch sponsorship / wallet-infra
evaluation. The MCP config and the API key are **per-machine and not committed**, so each
dev machine needs this one-time setup. Nothing secret lands in the repo.

## Why this shape

- The secret (Openfort project key) lives **only in the macOS Keychain**.
- The MCP launch command pulls the key from Keychain **at spawn**, so it never sits in
  plaintext in `~/.claude.json` or in chat, and it works whether Claude Code is launched
  from a terminal or the GUI.
- Use a **dev/sandbox** Openfort project key (`sk_test_...`), never a production key.
  Blast radius of a leak is a throwaway project, and "rotate" becomes "delete the sandbox
  project."
- This is intentionally **not** a committed `.mcp.json`: a project `.mcp.json` would
  reference a Keychain item that only exists on the machine that created it, so it would
  fail on CI or another dev's machine.

## One-time setup on a new machine

1. Install the CLI and sync skills:

   ```bash
   npm install -g @openfort/cli
   openfort skills add        # installs openfort-* skills to ~/.claude/skills
   ```

2. Create (or reuse) a dev/sandbox project at https://dashboard.openfort.io, copy its
   **Secret key** (`sk_test_...`), and store it in Keychain:

   ```bash
   security add-generic-password -U -a "$USER" -s OPENFORT_API_KEY -w 'sk_test_...'
   ```

3. Add the `openfort` server to `mcpServers` in `~/.claude.json`, wrapping the launch so it
   reads the key from Keychain. Replace `andysustic` with your macOS username — it must
   match the `-a` value used in step 2:

   ```json
   "openfort": {
     "command": "sh",
     "args": [
       "-c",
       "export OPENFORT_API_KEY=\"$(security find-generic-password -a andysustic -s OPENFORT_API_KEY -w)\"; exec npx openfort --mcp"
     ]
   }
   ```

4. (Optional) For direct `openfort` CLI use in your terminal, also add to `~/.zshrc`:

   ```bash
   export OPENFORT_API_KEY="$(security find-generic-password -a "$USER" -s OPENFORT_API_KEY -w 2>/dev/null)"
   ```

5. Restart Claude Code. On first MCP launch, approve the one-time Keychain prompt
   (*"security wants to use… OPENFORT_API_KEY"* → **Always Allow**).

## Verify (without printing the key)

```bash
OPENFORT_API_KEY="$(security find-generic-password -a "$USER" -s OPENFORT_API_KEY -w)" openfort accounts list
```

Expect a JSON result (e.g. `{"data": [], "total": 0}`) and exit 0.

## Context

This setup exists to evaluate Openfort as the **managed-provider** answer to the Kora plan's
first open decision (`operator-decision`: self-host Kora vs. a managed signer/policy provider)
for removing user-held SOL from AgentVouch flows. See
`.agents/plans/kora-usdc-fee-abstraction.plan.md` and `docs/USDC_SPONSORED_CHECKOUT_HANDOFF.md`.
Before treating Openfort as a Kora replacement, confirm it can sponsor Solana **fees + rent**
(its headline gasless story is EVM: ERC-4337 paymasters / EIP-7702).
