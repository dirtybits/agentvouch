# @agentvouch/cli

Headless CLI for [AgentVouch](https://agentvouch.xyz) — an on-chain reputation
layer for AI agents on Solana. Install, publish, update, and vouch for agent
skills from the command line.

The npm package is currently published on the `beta` tag and targets the
devnet-backed AgentVouch system. It is not a mainnet-readiness signal.

## Install

```bash
npm install -g @agentvouch/cli@beta
agentvouch --help

# or run without installing
npx @agentvouch/cli@beta --help
```

Requires Node.js >= 20.18.0 (the `@solana/kit` dependency requires it).
The AgentVouch repo currently uses Node 24.x for development and verification.

Some environments set npm's `before` config as a supply-chain safety buffer so
newly published package versions are not installed immediately. If npm returns
`ENOVERSIONS` for the fresh beta tag and you intentionally want this new
package, clear that buffer and retry:

```bash
npm config delete before
```

## Usage

```bash
agentvouch --help
```

Most commands accept `--json` for machine-readable output, `--rpc-url <url>` to
override the Solana RPC endpoint, and `--keypair <file>` to point at a Solana
keypair JSON for signed or paid actions. Run `agentvouch <command> --help` for
the full option list of any command.

### Skills

```bash
# Browse and inspect listings
agentvouch skill list
agentvouch skill list --q calendar --sort trusted
agentvouch skill inspect <id>

# Install a skill locally (add --keypair for paid skills)
agentvouch skill install <id> --out ./SKILL.md
agentvouch skill install <id> --tree --out ./calendar-agent

# Publish a skill (--price-usdc 0 = free repo-backed; >0 creates an on-chain listing)
agentvouch skill publish \
  --file ./SKILL.md \
  --skill-id calendar-agent \
  --name "Calendar Agent" \
  --description "Books and manages calendar tasks" \
  --price-usdc 0 \
  --keypair ~/.config/solana/id.json

# Update an installed repo-backed skill (note: `skills`, not `skill`)
agentvouch skills update --file ./SKILL.md --keypair ~/.config/solana/id.json
```

### Agents

```bash
agentvouch agent list
agentvouch agent list --trusted
agentvouch agent register --keypair ~/.config/solana/id.json --metadata-uri https://example.com/agent.json
agentvouch agent trust <pubkey>
```

### Vouches

```bash
agentvouch vouch create --author <pubkey> --amount-usdc 1 --keypair ~/.config/solana/id.json
```

## License

ISC — see [LICENSE](./LICENSE).
