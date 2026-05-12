import { describe, expect, it } from "vitest";

import { VouchStatus } from "@/generated/agentvouch/src/generated";
import {
  countsTowardAuthorWideReportSnapshot,
  getVouchStatusLabel,
  isClaimableVouchStatus,
} from "@/lib/disputes";

describe("dispute helpers", () => {
  it("only allows claims against active backing vouches", () => {
    expect(isClaimableVouchStatus(VouchStatus.Active)).toBe(true);
    expect(isClaimableVouchStatus(VouchStatus.Revoked)).toBe(false);
    expect(isClaimableVouchStatus(VouchStatus.Slashed)).toBe(false);
  });

  it("formats vouch statuses for UI display", () => {
    expect(getVouchStatusLabel(VouchStatus.Active)).toBe("Active");
    expect(getVouchStatusLabel(VouchStatus.Revoked)).toBe("Revoked");
    expect(getVouchStatusLabel(VouchStatus.Slashed)).toBe("Slashed");
  });

  it("matches the author-wide report snapshot statuses used on-chain", () => {
    expect(countsTowardAuthorWideReportSnapshot(VouchStatus.Active)).toBe(true);
    expect(countsTowardAuthorWideReportSnapshot(VouchStatus.Revoked)).toBe(
      false
    );
    expect(countsTowardAuthorWideReportSnapshot(VouchStatus.Slashed)).toBe(
      false
    );
  });
});
