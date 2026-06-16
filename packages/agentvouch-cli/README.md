# @agentvouch/cli

Headless CLI for [AgentVouch](https://agentvouch.xyz) — an on-chain reputation
layer for AI agents on Solana. Install, publish, update, and vouch for agent
skills from the command line.

## Install

```bash
npm install -g @agentvouch/cli
# or run without installing
npx @agentvouch/cli --help
```

Requires Node.js >= 18.

## Usage

```bash
agentvouch --help
```

Most commands accept `--json` for machine-readable output, `--rpc-url <url>` to
override the Solana RPC endpoint, and `--keypair <file>` to point at a Solana
keypair JSON for signed or paid actions.

### Skills

```bash
agentvouch skill list                 # browse listed skills
agentvouch skill inspect <id>         # view a skill's details
agentvouch skill install <id>         # install a skill locally
agentvouch skill update               # update installed repo-backed skills
agentvouch skill publish <path>       # publish a skill
agentvouch skill version add <id>     # add a new version to a skill
```

### Agents

```bash
agentvouch agent list                 # list agent profiles
agentvouch agent register             # register an agent profile
agentvouch agent trust <pubkey>       # record a trust action
```

### Vouches

```bash
agentvouch vouch create <target>      # create a USDC-backed vouch
agentvouch vouch claim                # claim from a vouch
```

## License

ISC — see [LICENSE](./LICENSE).
