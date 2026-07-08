---
name: base-update-skill-listing
overview: "Add updateSkillListing (metadata edit + revision bump) to the Base v1 candidate contract with Solana-parity semantics and the mid-report dispute lock, expose it through the ChainWallet seam, and wire the existing listing-management UI for Base authors — closing the gap found in the 2026-07-06 instruction-inventory sweep (Base listings are currently immutable: currentRevision is set to 1 at create and never bumped)."
todos:
  - id: implement-update-contract
    content: "Add updateSkillListing(bytes32 id, string uri, string name, string description, uint256 priceUsdcMicros) to contracts/base-poc/src/AgentVouchEvm.sol per the locked semantics in this plan: author-only, registered, whenNotPaused, status != Removed; revision bumps ONLY when uri or price changed; bump path reverts DisputeLocked when l.lockedByDispute OR profiles[msg.sender].openDisputes > 0; bump increments currentRevision and initializes settlements[id][newRev] exactly like createSkillListing does for revision 1; free/paid transitions maintain activeFreeListingCount with the bond-floor check; emit SkillListingUpdated."
    status: pending
  - id: forge-update-tests
    content: "New contracts/base-poc/test/AgentVouchEvm.UpdateListing.t.sol covering the parity matrix in this plan: metadata-only no-bump, uri/price bump, dispute-lock on bump path (openDisputes > 0) while metadata-only still allowed, paused revert, non-author/unregistered/removed reverts, price floor, free->paid and paid->free counter + bond-floor behavior, old-revision proceeds still withdrawable after bump, purchase at new revision/price, and stale EIP-3009 authorization (bound to old revision/price) failing after bump."
    status: pending
  - id: sync-abis
    content: "Add updateSkillListing + SkillListingUpdated to contracts/base-poc/ui/src/abi.ts and web/lib/adapters/agentVouchEvmAbi.ts (event needed for backfill/recovery scans); harness abi.ts only if the harness gains an update flow."
    status: pending
  - id: chainwallet-seam
    content: "Approved ChainWallet interface expansion (founder request 2026-07-07): add UpdateSkillListingInput + updateSkillListing(input) to web/lib/adapters/types.ts; implement in the Base ChainWallet write module following the createSkillListing pattern (client-only, dynamic imports, sponsored UserOp); Solana facade may keep delegating to the existing useReputationOracle update path — do not rewrite Solana writes for this."
    status: pending
  - id: web-edit-flow
    content: "Route Base authors' listing edit through the seam: the listing-management surface reached from web/app/skills/[id]/SkillDetailClient.tsx uses ChainWallet.updateSkillListing for eip155:* rows, then updates the DB row (name/description/uri/price, refreshed evm_tx_hash) via the existing signed Base listing PATCH pattern from PR #78/#79, and re-hydrates so currentRevision/price render live. Keep the storage-lowercase/display-checksum and chain-exclusivity rules from AGENTS.md; extend family-guard tests if new Base-facing files are added."
    status: pending
  - id: verify-update
    content: "Gate + evidence: forge test --root contracts/base-poc green including the new suite; web format/lint/typecheck/vitest + next build --webpack (Node 24 PATH); Base Sepolia smoke on the deployed candidate: create -> purchase rev 1 -> update price (bump) -> withdraw rev-1 proceeds -> purchase rev 2 at the new price -> raw download for both buyers; record tx hashes, revisions, and USDC deltas; update the phase-9 plan ledger and web/public/skill.md if listing-update semantics are documented there."
    status: pending
isProject: false
---

# Base updateSkillListing (Revision Bump) Port

## Goal

Base authors can edit a listing (uri, name, description, price) with Solana-parity semantics:
metadata-only edits are cheap and never rotate settlements; uri/price changes bump
`currentRevision` into a fresh settlement bucket; and the revision-rotation dodge is blocked
mid-report. Today Base listings are immutable — `currentRevision` is written once at create
(`AgentVouchEvm.sol:311`, verified 2026-07-07) and no update function exists, and remove+recreate
is not a workaround because `listingId = keccak(author, skillIdHash)` collides with the Removed
row (`ListingExists`).

## Why the dispute lock is load-bearing (do not simplify it away)

Solana's `update_skill_listing` blocks the revision bump while dispute-locked because a bump
rotates to a fresh, unlocked settlement — the rotation dodge that let authors keep selling
mid-dispute (readiness doc P0.1 review amendments, 2026-06-09). The same dodge would exist on
Base the moment updates ship. Base wrinkle (verified 2026-07-07): `SkillListing.lockedByDispute`
exists and is read by `removeSkillListing`/one other guard but is **never written** — reports
are author-wide and set no listing flag. So the bump guard must check **both**
`l.lockedByDispute` (forward-compat: the A1 port's listing-referenced reports should start
setting it) **and** `profiles[msg.sender].openDisputes > 0` (the live author-wide signal today,
same counter `withdrawAuthorBond` and `revokeVouch` already use).

## Locked semantics (Solana parity, verified against `update_skill_listing.rs` 2026-07-07)

1. **Callable when:** caller is the listing author, registered, `whenNotPaused`, and
   `status != Removed` (Suspended is unreachable on Base today but keep the check
   Removed-only for parity).
2. **Updatable fields:** `uri`, `name`, `description`, `priceUsdcMicros` — all passed every
   call, full-replace (no partial-update flags).
3. **Revision bump iff `uri` or `price` changed.** Name/description-only edits do NOT bump and
   are allowed even while dispute-locked (parity). On bump:
   - guard: revert `DisputeLocked` per the section above;
   - `currentRevision += 1` (uint64; overflow is practically unreachable, no special handling
     beyond Solidity 0.8 checked math);
   - initialize `settlements[id][newRevision]` exactly as `createSkillListing` does for
     revision 1 (`initialized = true`, `createdAt`/`updatedAt` = block.timestamp,
     `AgentVouchEvm.sol:315-317`);
   - prior revisions stay untouched — `withdrawAuthorProceeds(id, oldRevision, amount)` must
     keep working (test it).
4. **Price rules:** `price == 0` is free; free requires
   `authorBondUsdcMicros >= minAuthorBondForFreeListingUsdcMicros` (revert
   `FreeListingBondFloor`); paid requires `price >= minPaidListingPriceUsdcMicros` (revert
   `BelowMinPaidPrice`). Free/paid transitions maintain
   `profiles[author].activeFreeListingCount` (paid→free increments after the bond check;
   free→paid decrements) — mirror the create/remove bookkeeping so the counter can never
   underflow.
5. **Event:** `SkillListingUpdated(bytes32 indexed listingId, uint64 revision, uint256 priceUsdcMicros, bool free, bool revisionChanged)` — enough for indexers and the
   Base Sepolia log-recovery pattern used in PR #79.
6. **Known-good properties to assert, not re-invent:** the x402 Lane B bound nonce is
   `keccak(buyer, id, currentRevision, price)` (`AgentVouchEvm.sol:372`), so a bump or price
   change invalidates outstanding EIP-3009 authorizations — a stale agent authorization must
   fail after update (test). `purchaseId` binds revision, so rev-1 and rev-2 purchases coexist.

## Files To Change

- `contracts/base-poc/src/AgentVouchEvm.sol`: the new function + `SkillListingUpdated` event
  (+ any new custom errors). No struct changes expected — `SkillListing` and
  `ListingSettlement` already carry everything needed.
- `contracts/base-poc/test/AgentVouchEvm.UpdateListing.t.sol`: new suite (matrix in todo 2).
- `contracts/base-poc/ui/src/abi.ts`, `web/lib/adapters/agentVouchEvmAbi.ts`: ABI + event sync.
- `web/lib/adapters/types.ts`: `UpdateSkillListingInput` + `ChainWallet.updateSkillListing`
  (interface expansion approved by the founder in-session, 2026-07-07 — this is the AGENTS.md
  "ask first" case, already asked).
- Base ChainWallet write module (follow the Phase 5 `createSkillListing` implementation
  pattern; client-only, dynamic imports, CDP-sponsored UserOp).
- `web/app/skills/[id]/SkillDetailClient.tsx` + the listing-management surface it links:
  chain-aware edit routing (Solana keeps its existing `useReputationOracle` path; Base goes
  through the seam) + DB row update via the signed Base listing PATCH pattern.
- `web/__tests__/`: seam method tests; extend `phase2-circleback.test.ts` marker lists if new
  Base-facing files are added.

## Implementation order

1. Contract + forge tests (todos 1–2) — independently landable and the part the security
   review must cover.
2. ABI sync (todo 3).
3. Seam + web edit flow (todos 4–5) — can be a second PR if the a2a loop prefers smaller
   slices; one phase = one PR still applies per slice.
4. Verification + ledger updates (todo 6).

## Coordination with the A1 port (Phase 9b-2)

Independent but order-aware: this plan can land before or after
`base-a1-voucher-slashing-port`. If A1 lands first and its listing-referenced reports start
setting `lockedByDispute`, the bump guard here honors it automatically; if this lands first,
the `openDisputes > 0` check carries the invariant alone. **Both must be in the v1 candidate
before the Phase 9c security review** — update rotation gates settlement integrity even though
it moves no USDC directly. Update the review scope list in `docs/PRODUCTION_RUNBOOK.md`'s Base
V1 Candidate Operations section to include `updateSkillListing` when this merges.

## Verification

- `forge test --root contracts/base-poc` — new UpdateListing suite + all existing suites green.
- Web gate: `npm run format:check`, workspace lint, typecheck, vitest,
  `npm exec --workspace @agentvouch/web -- next build --webpack`
  (export the Node 24 PATH per AGENTS.md §1.2).
- Base Sepolia live smoke on the deployed candidate: create → buyer A purchases rev 1 → author
  updates price (bump) → author withdraws rev-1 proceeds → buyer B purchases rev 2 at the new
  price → raw download works for both buyers → a pre-update EIP-3009 authorization fails.
  Record tx hashes, revisions, and USDC deltas at explicit block numbers
  (`base-sepolia-rpc.publicnode.com` for reads).

## Rollback

Contract change ships with the next Sepolia candidate deploy; until then it is repo-only —
revert the PR. Web seam/UI changes are additive and revert cleanly; no DB migration (listing
rows already store price/uri/name/description and re-hydrate from chain).

## Blockers / open questions

- None blocking. One deliberate parity choice to flag for the reviewer: metadata-only edits
  remain allowed while dispute-locked (Solana behavior). If the reviewer or founder prefers
  freezing ALL edits mid-report on Base, that is a one-line change — record the decision here
  either way with a dated note.
