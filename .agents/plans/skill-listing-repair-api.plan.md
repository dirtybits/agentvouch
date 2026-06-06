---
name: skill-listing-repair-api
overview: "Add a wallet-safe listing repair API that prepares unsigned create/update transactions, confirms signed submissions, and links repo skills to verified on-chain listings."
todos:
  - id: define-contract
    content: Define prepare/confirm request and response contracts for repo skill listing repair without server custody.
    status: pending
  - id: share-validation
    content: Extract shared repo-skill author auth and on-chain listing validation from the existing PATCH route.
    status: pending
  - id: prepare-transaction
    content: Implement a prepare endpoint that derives the listing PDA and returns an unsigned create or update transaction for the author wallet to sign.
    status: pending
  - id: confirm-link
    content: Implement a confirm endpoint that verifies the submitted transaction signature and patches the DB only after the on-chain listing matches the repo skill.
    status: pending
  - id: update-clients-docs
    content: Document the repair API in OpenAPI, skill.md, and optionally route browser/CLI repair flows through it.
    status: pending
  - id: verify-repair
    content: Add API tests and run web build plus targeted route tests proving prepare/confirm behavior and failure modes.
    status: pending
isProject: false
---

# Skill Listing Repair API Plan

## Goal
Add a public, author-wallet-safe repair flow for repo-backed skills whose DB row needs to be linked or relinked to the current on-chain `SkillListing` PDA. The server should prepare the correct transaction and verify the result, but it must never custody the author keypair or sign author transactions.

## Scope
- In scope: new Next.js API routes under `/api/skills/{id}/listing/repair`, shared validation helpers, route tests, OpenAPI/docs updates, and optional client adoption after the API is stable.
- In scope: repo-backed skills with wallet authors, current devnet program ID `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`, native devnet USDC mint, and canonical `skillUri = https://agentvouch.xyz/api/skills/{id}/raw`.
- In scope: creating a missing listing, updating a mismatched existing listing when `update_skill_listing` is available, or returning `noop` when the current listing already matches.
- Out of scope: server-side signing, relayer-paid transaction submission, custody of author keys, x402 settlement bridge enablement, mainnet defaults, and changing the existing `PATCH /api/skills/{id}` contract.

## API Contract

### `POST /api/skills/{id}/listing/repair/prepare`
Builds an unsigned transaction for the author wallet to sign and submit.

Request body:

```json
{
  "auth": {
    "pubkey": "authorWallet",
    "signature": "base64-signature",
    "message": "AgentVouch Skill Repo\nAction: repair-listing\nTimestamp: 1709234567890",
    "timestamp": 1709234567890
  },
  "price_usdc_micros": "1000000",
  "mode": "create-or-update"
}
```

Response body:

```json
{
  "skill_id": "repo uuid",
  "repo_skill_id": "author-defined-skill-id",
  "action": "create",
  "listing_address": "SkillListingPda",
  "skill_uri": "https://agentvouch.xyz/api/skills/{id}/raw",
  "price_usdc_micros": "1000000",
  "currency_mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "chain_context": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "program_id": "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg",
  "transaction": {
    "encoding": "base64",
    "format": "versioned",
    "serialized": "base64-transaction",
    "recent_blockhash": "...",
    "last_valid_block_height": 123
  },
  "required_signers": ["authorWallet"]
}
```

If the listing already matches, return `action: "noop"` and `transaction: null`.

### `POST /api/skills/{id}/listing/repair/confirm`
Verifies a submitted Solana transaction signature, rereads the on-chain listing, and patches the repo DB row.

Request body:

```json
{
  "auth": {
    "pubkey": "authorWallet",
    "signature": "base64-signature",
    "message": "AgentVouch Skill Repo\nAction: repair-listing\nTimestamp: 1709234567890",
    "timestamp": 1709234567890
  },
  "listing_address": "SkillListingPda",
  "transaction_signature": "confirmedSolanaSignature"
}
```

Response body should mirror the updated skill row from `PATCH /api/skills/{id}`, plus a small repair summary:

```json
{
  "id": "repo uuid",
  "on_chain_address": "SkillListingPda",
  "on_chain_program_id": "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg",
  "price_usdc_micros": "1000000",
  "payment_flow": "direct-purchase-skill",
  "repair": {
    "transaction_signature": "confirmedSolanaSignature",
    "verified": true
  }
}
```

## Files To Change
- `web/app/api/skills/[id]/listing/repair/prepare/route.ts`: new route that authenticates the author, derives the listing PDA, builds the unsigned transaction, and returns serialized transaction data.
- `web/app/api/skills/[id]/listing/repair/confirm/route.ts`: new route that authenticates the author, verifies the transaction signature, validates the on-chain listing, and patches the skill row.
- `web/lib/skillListingRepair.ts`: shared repair contract, skill lookup, auth checks, PDA derivation, listing comparison, transaction building, signature confirmation, and DB update helpers.
- `web/lib/onchain.ts`: extend listing reads to expose full fields needed for validation, not just `{ priceUsdcMicros, author }`.
- `web/lib/auth.ts`: reuse `verifyWalletSignature` and `buildSignMessage`; no new auth scheme unless the action string needs a helper constant.
- `web/lib/site.ts`: use `getCanonicalUrl("/api/skills/{id}/raw")` for `skillUri`.
- `web/generated/agentvouch/src/generated/*`: use generated `createSkillListing`, `updateSkillListing`, and PDA helpers; do not hand-edit generated code.
- `web/public/openapi.json`: document both repair endpoints and their auth/transaction payloads.
- `web/public/skill.md`: add a short agent-facing section describing prepare/sign/confirm for listing repair.
- `web/__tests__/api/skills-listing-repair.test.ts`: add route tests for prepare/confirm success and failures.
- Optional after API lands: `web/app/skills/[id]/SkillDetailClient.tsx`, `web/app/skills/publish/page.tsx`, and `packages/agentvouch-cli/src/lib/publish.ts` can adopt the API instead of doing local create + `PATCH` directly.

## Implementation Steps

### 1. Extract shared author and skill validation
Create `web/lib/skillListingRepair.ts` with helpers that:

- Load the repo skill by UUID from `skills`.
- Require `source !== "chain"` by implication: this endpoint is for DB repo skills, not `chain-*` virtual rows.
- Verify `auth` using `verifyWalletSignature`.
- Require `auth.message` to equal `buildSignMessage("repair-listing", auth.timestamp)` or explicitly allow the existing `"publish-skill"` action during a short compatibility period.
- Require `skills.author_pubkey` to equal the verified wallet.
- Require a wallet author; reject GitHub/API-token-only skills until they are republished or linked to a wallet.
- Compute canonical `skillUri` with `getCanonicalUrl(`/api/skills/${id}/raw`)`.
- Derive the expected listing PDA from `(author_pubkey, skill.skill_id)` using the generated `findSkillListingPda` helper.

### 2. Centralize listing comparison
Add a validation function that compares the on-chain listing against the DB skill:

- listing PDA equals the derived PDA.
- listing author equals `skills.author_pubkey`.
- listing `skillId` equals `skills.skill_id`.
- listing `skillUri` equals the canonical raw URL.
- listing name and description match current DB values within on-chain length limits.
- listing `priceUsdcMicros` equals the requested repair price, or the existing DB `price_usdc_micros` when no override is provided.
- listing currency mint and program ID match current configured devnet values.
- listing is not closed/removed if that status is represented in the account.

Return a structured diff such as `{ field, expected, actual }[]` so API errors and tests can be precise.

### 3. Implement prepare
The prepare endpoint should:

- Run shared auth/skill validation.
- Normalize `price_usdc_micros` with the same rules used by publish/listing code.
- Derive `listing_address`, `listingSettlement`, author proceeds vault authority, author proceeds vault, config PDA, author profile PDA, optional author bond PDA for free listings, and USDC mint.
- Fetch the current listing if it exists.
- Return `noop` with no transaction when the current listing validates cleanly.
- Build `createSkillListing` when the listing account is missing.
- Build `updateSkillListing` when the listing exists but differs and the author owns it.
- Fail with `409` if the listing exists but belongs to another author, has an unexpected `skillId`, or otherwise cannot be safely updated.
- Return a serialized unsigned transaction with a fresh blockhash and required signer set containing the author wallet only.

Use generated Codama helpers where possible. If the generated builder requires a `TransactionSigner`, use a narrow server-side signer-placeholder adapter only for account metas; do not introduce a private key.

### 4. Implement confirm
The confirm endpoint should:

- Run the same auth/skill validation.
- Confirm `transaction_signature` on `DEFAULT_SOLANA_RPC_URL`.
- Reread the expected listing with `useCache: false`.
- Run the centralized listing comparison.
- Only after validation succeeds, update `skills` with:
  - `on_chain_address`
  - `price_usdc_micros`
  - `currency_mint`
  - `on_chain_protocol_version`
  - `on_chain_program_id`
  - `chain_context` if missing or legacy
  - `updated_at = NOW()`
- Return the updated row with normalized `chain_context`, matching the existing `PATCH /api/skills/{id}` style.

This route may share the DB update helper with `PATCH /api/skills/{id}` so both paths enforce the same on-chain checks.

### 5. Keep existing PATCH but harden it
Do not remove `PATCH /api/skills/{id}` yet. Instead, refactor it to call the same shared validation and DB update helper used by confirm:

- Keep its body shape `{ auth, on_chain_address }`.
- Validate the on-chain listing against derived PDA, author, `skill_id`, canonical URI, and current program.
- Return the same 4xx status codes as the repair endpoints for mismatch cases.

This preserves the current CLI/browser flow while preventing stale or wrong PDA links.

### 6. Update docs and clients
Document the new flow in `web/public/openapi.json` and `web/public/skill.md`:

1. `POST /prepare` with signed author auth.
2. Author wallet signs and submits the returned transaction.
3. `POST /confirm` with signed author auth plus the Solana transaction signature.
4. Raw/archive paid download becomes available once the repo row is linked.

After API tests pass, optionally update browser listing repair UI and CLI relist/link-listing code to use prepare/confirm. That client adoption can be a follow-up PR if this API needs to land first.

## Verification
- `npm run test --workspace @agentvouch/web -- --run web/__tests__/api/skills-listing-repair.test.ts`
- `npm run test --workspace @agentvouch/web -- --run web/__tests__/api/skills-route.test.ts`
- `npm run build --workspace @agentvouch/web`

Test cases to add:

- `prepare` returns `create` for an unlinked repo skill and includes canonical `skill_uri`.
- `prepare` returns `noop` when the existing listing matches.
- `prepare` returns `update` when the existing listing is owned by the author but URI/price/name differs.
- `prepare` rejects non-author auth with `403`.
- `prepare` rejects missing wallet author with `400` or `409`.
- `prepare` rejects wrong-author existing PDA with `409`.
- `confirm` refuses to patch before the transaction is confirmed.
- `confirm` patches the DB only after rereading a valid on-chain listing.
- Existing `PATCH /api/skills/{id}` still works for a valid listing and now rejects mismatched PDA/author/URI cases.

Manual devnet smoke after tests:

- Pick a repo skill owned by a devnet wallet.
- Call `/prepare`, sign/submit the returned transaction with that wallet, then call `/confirm`.
- Verify `GET /api/skills/{id}` returns the repaired `on_chain_address`, current `on_chain_program_id`, USDC price, and `payment_flow: "direct-purchase-skill"`.
- Verify `GET /api/skills/{id}/raw` returns the expected paid flow rather than `listing-required`.

## Rollout
- Ship the hardened `PATCH` validation and new prepare/confirm routes behind normal API deployment.
- Keep existing browser and CLI flows working initially.
- Once confirmed in devnet, update the browser author listing flow to prefer prepare/confirm so Phantom and other wallets sign exactly the server-prepared instruction.
- Then update the CLI relist/link-listing flow to use prepare/confirm for consistency, while retaining a local transaction fallback only if needed.

## Rollback
- If prepare transaction construction fails in production, leave existing local-create + `PATCH` clients in place and hide any UI that calls prepare.
- If confirm validation is too strict, patch the shared comparator rather than bypassing validation entirely.
- If hardened `PATCH` blocks legitimate listings, temporarily allow the previous `PATCH` behavior only for current-program, author-matching listings while logging the mismatch details; then fix the comparator.
- No database migration rollback should be needed. The only persistent writes are the same `skills` columns the existing `PATCH` route already updates.

## Blockers And Assumptions
- Assumption: generated Codama helpers can build unsigned create/update listing instructions without a real server keypair. If they cannot, add a narrow local instruction builder in `web/lib/skillListingRepair.ts` using generated encoders and explicit account metas.
- Assumption: `update_skill_listing` supports all fields needed for repair: URI, name, description, and price. If it does not support a required field, `prepare` must return `409` with the exact blocker instead of creating a second listing.
- Assumption: the canonical raw URL should use `NEXT_PUBLIC_APP_URL` via `getCanonicalUrl`, not the incoming request origin.
- Blocker: if transaction confirmation from Vercel cannot reliably reach devnet RPC, confirm should accept a recently confirmed signature only after rereading the listing account itself. Do not patch based on submitted signatures alone.
