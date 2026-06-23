import { describe, expect, it } from "vitest";

import {
  isCurrentSkillListingAccountData,
  SKILL_LISTING_ACCOUNT_SIZE,
  validateSkillListingAccountData,
} from "@/lib/onchain";

const SKILL_LISTING_DISCRIMINATOR = Buffer.from([
  133, 247, 251, 51, 57, 31, 57, 30,
]);

function writeString(buffer: Buffer, offset: number, value: string) {
  const bytes = Buffer.from(value, "utf8");
  buffer.writeUInt32LE(bytes.length, offset);
  bytes.copy(buffer, offset + 4);
  return offset + 4 + bytes.length;
}

function buildCurrentSkillListingAccountData() {
  const buffer = Buffer.alloc(SKILL_LISTING_ACCOUNT_SIZE);
  let offset = 0;
  SKILL_LISTING_DISCRIMINATOR.copy(buffer, offset);
  offset += 8;
  offset += 32; // author
  offset = writeString(buffer, offset, "ipfs://skill");
  offset = writeString(buffer, offset, "skill name");
  offset = writeString(buffer, offset, "description");
  offset +=
    8 + // price_usdc_micros
    32 + // reward_vault
    32 + // reward_vault_rent_payer
    8 + // current_revision
    32 + // current_settlement
    32 + // current_author_proceeds_vault
    8 + // total_downloads
    8 + // total_revenue_usdc_micros
    8 + // total_author_revenue_usdc_micros
    8 + // total_voucher_revenue_usdc_micros
    8 + // active_reward_stake_usdc_micros
    4 + // active_reward_position_count
    16 + // reward_index_usdc_micros_x1e12
    8 + // unclaimed_voucher_revenue_usdc_micros
    8 + // created_at
    8; // updated_at
  buffer[offset] = 0; // SkillStatus::Active
  offset += 1;
  const lockedByDisputeOptionOffset = offset;
  buffer[offset] = 0; // Option<Pubkey>::None
  offset += 1;
  buffer[offset] = 1; // bump
  offset += 1;
  buffer[offset] = 1; // reward_vault_bump

  return {
    data: new Uint8Array(buffer),
    lockedByDisputeOptionOffset,
  };
}

describe("on-chain skill listing guards", () => {
  it("accepts current padded skill listing account data", () => {
    const { data } = buildCurrentSkillListingAccountData();

    expect(isCurrentSkillListingAccountData(data)).toBe(true);
    expect(validateSkillListingAccountData(data)).toEqual({ ok: true });
  });

  it("rejects legacy-sized skill listing account data before decode", () => {
    expect(isCurrentSkillListingAccountData(new Uint8Array(787))).toBe(false);
  });

  it("rejects stale same-sized listings with invalid option tags", () => {
    const { data, lockedByDisputeOptionOffset } =
      buildCurrentSkillListingAccountData();
    data[lockedByDisputeOptionOffset] = 255;

    expect(isCurrentSkillListingAccountData(data)).toBe(false);
    expect(validateSkillListingAccountData(data)).toEqual({
      ok: false,
      reason: "locked_by_dispute option tag is invalid",
    });
  });
});
