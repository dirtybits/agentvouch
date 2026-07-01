import { describe, expect, it } from "vitest";

import fs from "fs";
import path from "path";

import {
  getAuthorDisputeLiabilityScopeLabel,
  getAuthorDisputeReasonLabel,
  getAuthorDisputeRulingLabel,
  getAuthorDisputeStatusLabel,
  isActiveAuthorDisputeStatus,
} from "@/lib/authorDisputes";
import {
  AuthorDisputeLiabilityScope,
  AuthorDisputeReason,
  AuthorDisputeRuling,
  AuthorDisputeStatus,
} from "@/generated/agentvouch/src/generated";

describe("author dispute helpers", () => {
  it("formats author dispute reasons for UI", () => {
    expect(
      getAuthorDisputeReasonLabel(AuthorDisputeReason.MaliciousSkill)
    ).toBe("Malicious skill");
    expect(
      getAuthorDisputeReasonLabel(AuthorDisputeReason.FraudulentClaims)
    ).toBe("Fraudulent claims");
    expect(
      getAuthorDisputeReasonLabel(AuthorDisputeReason.FailedDelivery)
    ).toBe("Failed delivery");
    expect(getAuthorDisputeReasonLabel(AuthorDisputeReason.Other)).toBe(
      "Other"
    );
  });

  it("formats author dispute statuses and rulings", () => {
    expect(getAuthorDisputeStatusLabel(AuthorDisputeStatus.Open)).toBe("Open");
    expect(getAuthorDisputeStatusLabel(AuthorDisputeStatus.Resolved)).toBe(
      "Resolved"
    );
    expect(
      getAuthorDisputeStatusLabel(AuthorDisputeStatus.SlashingVouchers)
    ).toBe("Slashing in progress");
    expect(
      getAuthorDisputeLiabilityScopeLabel(
        AuthorDisputeLiabilityScope.AuthorBondOnly
      )
    ).toBe("Author bond only");
    expect(
      getAuthorDisputeLiabilityScopeLabel(
        AuthorDisputeLiabilityScope.AuthorBondThenVouchers
      )
    ).toBe("Author bond then vouchers");
    expect(getAuthorDisputeRulingLabel(AuthorDisputeRuling.Upheld)).toBe(
      "Upheld"
    );
    expect(getAuthorDisputeRulingLabel(AuthorDisputeRuling.Dismissed)).toBe(
      "Dismissed"
    );
    expect(getAuthorDisputeRulingLabel(null)).toBeNull();
  });

  it("counts SlashingVouchers as an active dispute for trust metrics", () => {
    // Mid-slash the ruling is recorded but enforcement is still running and
    // the on-chain locks are live; the author must not read as dispute-free.
    expect(isActiveAuthorDisputeStatus(AuthorDisputeStatus.Open)).toBe(true);
    expect(
      isActiveAuthorDisputeStatus(AuthorDisputeStatus.SlashingVouchers)
    ).toBe(true);
    expect(isActiveAuthorDisputeStatus(AuthorDisputeStatus.Resolved)).toBe(
      false
    );

    // Both metric aggregators must use the shared helper, not a raw
    // status === Open comparison that silently excludes SlashingVouchers.
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/authorDisputes.ts"),
      "utf8"
    );
    expect(
      source.match(/isActiveAuthorDisputeStatus\(dispute\.account\.status\)/g)
    ).toHaveLength(2);
  });

  it("keeps the vouch-link dataSize filter in sync with the on-chain LEN", () => {
    // AuthorDisputeVouchLink::LEN (state/author_dispute_vouch_link.rs):
    // 8 + 32 + 32 + 32 + 1 + 32 (rent_payer) + 8 + 1 = 146. A stale size makes
    // the getProgramAccounts dataSize filter silently return no link accounts.
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/authorDisputes.ts"),
      "utf8"
    );
    expect(source).toContain("AUTHOR_DISPUTE_VOUCH_LINK_SIZE = 146");
  });
});
