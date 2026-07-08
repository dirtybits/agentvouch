---
name: base-update-skill-listing
overview: "Add updateSkillListing to the Base v1 candidate contract, expose it through ChainWallet, and wire Base author listing edits through verified PATCH persistence."
todos:
  - id: implement-update-contract
    content: "COMPLETED 2026-07-08: Added updateSkillListing with metadata validation, revision bump on uri/price change, dispute/open-report bump lock, settlement initialization, free/paid counter handling, and SkillListingUpdated event. Also applied the same metadata caps to createSkillListing. Review fix aligned MAX_LISTING_URI_BYTES with Solana's 256-byte listing URI cap."
    status: completed
  - id: forge-update-tests
    content: "COMPLETED 2026-07-08: Added AgentVouchEvm.UpdateListing.t.sol covering metadata-only no-bump, uri/price bump, openDisputes lock, pause/non-author/missing/removed reverts, validation, price floor, free/paid transitions, old-revision proceeds, rev-2 purchase, same-buyer rev-2 purchase, and stale EIP-3009 failure. Review fix updated the URI-too-long boundary to 257 bytes."
    status: completed
  - id: sync-abis
    content: "COMPLETED 2026-07-08: Synced updateSkillListing, SkillListingUpdated, and new validation errors across Base harness/UI ABIs and web EVM ABI/event decoding."
    status: completed
  - id: chainwallet-seam
    content: "COMPLETED 2026-07-08: Added UpdateSkillListingInput and ChainWallet.updateSkillListing; implemented Base passkey write + receipt validation; added explicit unsupported stubs for MetaMask injected Base and Solana facades."
    status: completed
  - id: web-edit-flow
    content: "COMPLETED 2026-07-08: Base authors can open the listing edit form, submit through ChainWallet.updateSkillListing using evm_listing_id, PATCH with mode=update and expected fields, and rehydrate the skill row after verified DB persistence. Review fix pins update verification to the server-derived canonical raw skill URL and rejects non-canonical submitted update URI paths before chain verification."
    status: completed
  - id: verify-update
    content: "COMPLETED 2026-07-08: Addressed review-1 findings. forge test --root contracts/base-poc passed; targeted API Vitest passed; npm run format:check, npm run lint, npm run typecheck, npm run test:web, and git diff --check passed. next build --webpack was attempted and failed because sandbox DNS cannot resolve fonts.googleapis.com for next/font. Base Sepolia live smoke remains deferred to the combined A1 run per sequencing note. docs/PRODUCTION_RUNBOOK.md review scope updated; web/public/skill.md unchanged because it does not document author update semantics. Phase-9 ledger update could not be written directly from this session due .agents write restriction."
    status: completed
isProject: false
---

# Base updateSkillListing (Revision Bump) Port

## Goal
Base authors can edit listing metadata and price with Solana-parity semantics. Metadata-only edits do not bump revision. URI or price changes bump `currentRevision`, initialize a fresh settlement bucket, and are blocked while the listing is dispute-locked or the author has open disputes.

## Implemented
- `contracts/base-poc/src/AgentVouchEvm.sol`
  - Added `updateSkillListing(bytes32,string,string,string,uint256)`.
  - Added `SkillListingUpdated(bytes32 indexed listingId, address indexed author, uint64 revision, uint256 price, bool free, bool revisionChanged)`.
  - Added uri/name/description validation errors and caps.
  - Aligned Base listing URI cap to Solana parity: 256 bytes.
  - Added shared settlement initialization helper.
- `contracts/base-poc/test/AgentVouchEvm.UpdateListing.t.sol`
  - Added the update parity and regression suite.
  - Updated URI validation boundary coverage to reject 257 bytes.
- ABI sync
  - `contracts/base-poc/harness/src/abi.ts`
  - `contracts/base-poc/ui/src/abi.ts`
  - `web/lib/adapters/agentVouchEvmAbi.ts`
  - `web/lib/adapters/baseWallet.ts`
- Web seam/API/UI
  - Added `UpdateSkillListingInput` and `ChainWallet.updateSkillListing`.
  - Implemented Base passkey `updateBaseSkillListing` with `SkillListingUpdated` receipt validation.
  - Added unsupported stubs for MetaMask injected Base and Solana ChainWallet facades.
  - Extended Base listing PATCH with `mode: "update"` and expected name/description/uri/price verification.
  - Pinned Base update-mode URI verification to `getCanonicalSkillRawUrl(id)` server-side.
  - Added rejection for submitted Base update URIs whose path/search do not match the canonical raw skill URL.
  - Routed Base author edit UI through the ChainWallet seam and PATCH rehydrate path.

## Verification
Passed:
- `forge test --root contracts/base-poc`
- `npm run test --workspace @agentvouch/web -- __tests__/api/skills-route.test.ts`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test:web`
- `git diff --check`

Attempted but blocked:
- `npm exec --workspace @agentvouch/web -- next build --webpack`
  - Blocker: `getaddrinfo ENOTFOUND fonts.googleapis.com`
  - Failed while fetching `Crimson Pro`, `Crimson Text`, and `Inconsolata` via `next/font`.

Deferred:
- Base Sepolia live smoke is deferred to the combined A1 run per plan sequencing.

## Notes
- `web/public/skill.md` was reviewed by scope and left unchanged.
- `docs/PRODUCTION_RUNBOOK.md` now includes `updateSkillListing` in the Base v1 security review surface.
- `.agents/plans/base-port-chain-adapter-phase-9.plan.md` should add `updateSkillListing` to the Base v1 contract scope, but this session could not write `.agents` files directly.
