---
name: Circle plugin review
overview: Review the newly available Circle plugin skills and MCP capabilities, then audit this repo’s USDC/x402 payment architecture against the most relevant Circle best practices and capability areas before deciding whether any code changes are warranted.
todos:
  - id: inventory-circle-plugin
    content: Review the Circle MCP tools and the locally available Circle skills most relevant to USDC and Solana
    status: completed
  - id: audit-usdc-path
    content: Audit the repo’s current USDC/x402 server, browser, CLI, and receipt flows against the Circle USDC best-practice guidance
    status: completed
  - id: classify-circle-capabilities
    content: Classify Circle capabilities into adopt now, defer later, or not relevant for the current AgentVouch architecture
    status: completed
  - id: deliver-review
    content: Produce a concise findings-first review with concrete recommendations and no speculative product churn
    status: completed
isProject: false
---

# Circle Plugin And Payment Audit

## What I found
- The Circle MCP server is documentation-oriented, not an execution/payment API. Its locally available tools are:
  - [`plugin-circle-circle/tools/search_circle_documentation.json`](/Users/andysustic/.cursor/projects/Users-andysustic-Repos-agent-reputation-oracle/mcps/plugin-circle-circle/tools/search_circle_documentation.json)
  - [`plugin-circle-circle/tools/get_circle_product_summary.json`](/Users/andysustic/.cursor/projects/Users-andysustic-Repos-agent-reputation-oracle/mcps/plugin-circle-circle/tools/get_circle_product_summary.json)
  - `list_available_coding_resources`
  - `get_coding_resource_details`
- There is no `mcp_auth` tool in the Circle MCP descriptors.
- The most relevant bundled Circle skills for this repo are:
  - [`skills/use-usdc/SKILL.md`](/Users/andysustic/.cursor/plugins/cache/cursor-public/circle/3f6a83777f9fac0c84eb94b4b8ab9bf0e18152c4/skills/use-usdc/SKILL.md)
  - [`skills/bridge-stablecoin/SKILL.md`](/Users/andysustic/.cursor/plugins/cache/cursor-public/circle/3f6a83777f9fac0c84eb94b4b8ab9bf0e18152c4/skills/bridge-stablecoin/SKILL.md)
  - plus the wallet/gateway skills listed in [`README.md`](/Users/andysustic/.cursor/plugins/cache/cursor-public/circle/3f6a83777f9fac0c84eb94b4b8ab9bf0e18152c4/README.md)
- This repo’s current USDC path is Solana-first and x402-first, centered on:
  - [`web/lib/x402.ts`](web/lib/x402.ts)
  - [`web/lib/browserX402.ts`](web/lib/browserX402.ts)
  - [`web/lib/usdcPurchases.ts`](web/lib/usdcPurchases.ts)
  - [`web/app/api/skills/[id]/raw/route.ts`](web/app/api/skills/[id]/raw/route.ts)
  - [`packages/agentvouch-cli/src/lib/install.ts`](packages/agentvouch-cli/src/lib/install.ts)

## Proposed review scope
- Review the Circle `use-usdc` skill against the Solana USDC pieces in this repo:
  - canonical mint handling
  - 6-decimal assumptions
  - ATA assumptions and recipient setup
  - transfer verification and entitlement recording
- Review the Circle `bridge-stablecoin` / `gateway` / wallet skills only as future-capability references, not as mandatory changes, and classify them as:
  - relevant now
  - relevant later
  - not relevant to the current architecture
- Audit the current repo for best-practice alignment in the highest-value files:
  - [`web/lib/x402.ts`](web/lib/x402.ts)
  - [`web/app/api/skills/[id]/raw/route.ts`](web/app/api/skills/[id]/raw/route.ts)
  - [`web/lib/usdcPurchases.ts`](web/lib/usdcPurchases.ts)
  - [`web/lib/browserX402.ts`](web/lib/browserX402.ts)
  - [`web/app/api/skills/route.ts`](web/app/api/skills/route.ts)
  - [`packages/agentvouch-cli/src/lib/install.ts`](packages/agentvouch-cli/src/lib/install.ts)
- Produce a review with concrete findings, prioritized by:
  - security / correctness gaps
  - API or architecture mismatches
  - missed Circle capabilities worth adopting
  - things that are already fine and should stay as-is

## Expected output
- A concise review of the Circle plugin skills most relevant to this repo.
- A gap analysis of current code vs Circle USDC/Solana best practices.
- A short recommendation list split into:
  - adopt now
  - defer for later
  - ignore for this repo

## Likely conclusions to test
- `use-usdc` is the main best-practices source for the current codebase.
- `bridge-stablecoin`, `gateway`, and Circle wallet skills are only relevant if AgentVouch expands from Solana x402 checkout into cross-chain USDC or managed-wallet flows.
- The review should focus more on payment correctness and parity between browser/server/CLI than on adding new Circle products by default.