import { VouchStatus } from "@/generated/agentvouch/src/generated";

export function isClaimableVouchStatus(
  status: VouchStatus | number | null | undefined
): boolean {
  return status === VouchStatus.Active;
}

export function countsTowardAuthorWideReportSnapshot(
  status: VouchStatus | number | null | undefined
): boolean {
  return status === VouchStatus.Active;
}

export function getVouchStatusLabel(
  status: VouchStatus | number | null | undefined
): string {
  switch (status) {
    case VouchStatus.Active:
      return "Active";
    case VouchStatus.Revoked:
      return "Revoked";
    case VouchStatus.Slashed:
      return "Slashed";
    default:
      return "Unknown";
  }
}
