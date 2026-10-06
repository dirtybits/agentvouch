import { describe, expect, it } from "vitest";
import {
  getPublicSkillAuthorSlug,
  getPublicSkillPath,
  isUuidLike,
} from "@/lib/skillUrls";

describe("public skill URL boundaries", () => {
  it("accepts only RFC UUID versions and variants before route handlers cast IDs", () => {
    for (const id of [
      "550e8400-e29b-11d4-a716-446655440000",
      "550e8400-e29b-21d4-8716-446655440000",
      "550e8400-e29b-31d4-9716-446655440000",
      "550e8400-e29b-41d4-8716-446655440000",
      "550e8400-e29b-51d4-b716-446655440000",
    ]) {
      expect(isUuidLike(id), id).toBe(true);
    }

    for (const id of [
      "550e8400-e29b-01d4-8716-446655440000",
      "550e8400-e29b-61d4-8716-446655440000",
      "550e8400-e29b-41d4-7716-446655440000",
      "{550e8400-e29b-41d4-8716-446655440000}",
      "550e8400-e29b-41d4-8716-446655440000 ",
    ]) {
      expect(isUuidLike(id), id).toBe(false);
    }
  });

  it("derives stable fallback author slugs from supported author identities", () => {
    expect(
      getPublicSkillAuthorSlug({
        id: "11111111-1111-4111-8111-111111111111",
        author_handle: "Ada Lovelace",
      })
    ).toBe("ada-lovelace");
    expect(
      getPublicSkillAuthorSlug({
        id: "11111111-1111-4111-8111-111111111111",
        author_pubkey: "9PSngwuraiLsgtXQSVGZAdDAfxaNx6MF5hW8paWQNo9h",
      })
    ).toBe("wallet-9psngwur");
    expect(
      getPublicSkillAuthorSlug({
        id: "11111111-1111-4111-8111-111111111111",
        publisher_identity_key: "github:Octo Cat",
      })
    ).toBe("github-octo-cat");
  });

  it("encodes persisted slugs and chain-only IDs as a single path segment", () => {
    expect(
      getPublicSkillPath({
        id: "11111111-1111-4111-8111-111111111111",
        public_author_slug: "alice/bob",
        public_slug: "../../private",
      })
    ).toBe("/skills/alice%2Fbob/..%2F..%2Fprivate");
    expect(getPublicSkillPath({ id: "chain-address/with?query" })).toBe(
      "/skills/chain-address%2Fwith%3Fquery"
    );
  });
});
