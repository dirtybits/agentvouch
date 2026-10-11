import { describe, expect, it } from "vitest";
import {
  AGENTVOUCH_PUBLIC_ORIGIN,
  CHAIN_SKILL_PREFIX,
  buildPublicAuthorSlugBase,
  buildPublicSkillSlug,
  buildPublicSkillSlugBase,
  getCanonicalSkillRawUrl,
  getPublicSkillAuthorSlug,
  getPublicSkillPath,
  getPublicSkillSlug,
  isUuidLike,
} from "@/lib/skillUrls";

const UUID = "595f5534-07ae-4839-a45a-b6858ab731fe";

describe("skillUrls slug helpers", () => {
  it("buildPublicSkillSlugBase slugifies skill ids and falls back to 'skill' when empty", () => {
    expect(buildPublicSkillSlugBase("Calendar Agent")).toBe("calendar-agent");
    expect(buildPublicSkillSlugBase("My-Great--SKILL!")).toBe("my-great-skill");
    expect(buildPublicSkillSlugBase("a.b-c_d e_f")).toBe("a-b-c-d-e-f");
    expect(buildPublicSkillSlugBase("")).toBe("skill");
    expect(buildPublicSkillSlugBase("!!!###")).toBe("skill");
    expect(buildPublicSkillSlugBase("- - -")).toBe("skill");
  });

  it("buildPublicSkillSlug keeps the base slug and appends a short id suffix only when the route is taken", () => {
    expect(buildPublicSkillSlug({ id: UUID, skill_id: "calendar-agent" })).toBe(
      "calendar-agent"
    );
    expect(
      buildPublicSkillSlug({
        id: UUID,
        skill_id: "calendar-agent",
        existingRouteTaken: true,
      })
    ).toBe("calendar-agent-595f5534");
    expect(buildPublicSkillSlug({ id: UUID, skill_id: "" })).toBe("skill");
    expect(
      buildPublicSkillSlug({
        id: UUID,
        skill_id: "UPPER_SCREENS--WITH--SPACES",
        existingRouteTaken: true,
      })
    ).toBe("upper-screens-with-spaces-595f5534");
  });

  it("buildPublicAuthorSlugBase prioritizes handle, then pubkey, then identity key", () => {
    expect(
      buildPublicAuthorSlugBase({ id: UUID, author_handle: "Andy Sus" })
    ).toBe("andy-sus");
    expect(
      buildPublicAuthorSlugBase({ id: UUID, author_handle: "Andy Sus" })
    ).toBe("andy-sus");
    expect(
      buildPublicAuthorSlugBase({
        id: UUID,
        author_handle: "",
        author_pubkey: "AbCdEf12",
      })
    ).toBe("wallet-abcdef12");
    expect(
      buildPublicAuthorSlugBase({
        id: UUID,
        author_handle: null,
        author_pubkey: "AbCdEf123456789",
      })
    ).toBe("wallet-abcdef12");
    expect(buildPublicAuthorSlugBase({ id: UUID, author_pubkey: "12" })).toBe(
      "wallet-12"
    );
  });

  it("buildPublicAuthorSlugBase derives github-style identity slugs and falls back to publisher id", () => {
    expect(
      buildPublicAuthorSlugBase({
        id: UUID,
        publisher_identity_key: "github:dirtybits/agent-skills",
      })
    ).toBe("github-dirtybits-agent-skills");
    expect(
      buildPublicAuthorSlugBase({ id: UUID, publisher_identity_key: "x" })
    ).toBe("x-x");
    expect(buildPublicAuthorSlugBase({ id: UUID })).toBe("publisher-595f5534");
  });

  it("slug length is capped at the 64-char name limit", () => {
    const long = "calendar-agent-very-".repeat(10);
    expect(buildPublicSkillSlugBase(long).length).toBeLessThanOrEqual(64);
  });
});

describe("skillUrls slug selection", () => {
  it("getPublicSkillSlug prefers an explicit slug, then chain ids, skill ids, then the db id", () => {
    expect(getPublicSkillSlug({ id: UUID, public_slug: "nice-slug" })).toBe(
      "nice-slug"
    );
    expect(getPublicSkillSlug({ id: UUID, public_slug: "" })).toBe(UUID);
    expect(
      getPublicSkillSlug({ id: `${CHAIN_SKILL_PREFIX}${UUID.slice(4)}` })
    ).toBe(`${CHAIN_SKILL_PREFIX}${UUID.slice(4)}`);
    expect(getPublicSkillSlug({ id: UUID, skill_id: "calendar-agent" })).toBe(
      "calendar-agent"
    );
    expect(getPublicSkillSlug({ id: UUID, skill_id: "" })).toBe(UUID);
    expect(getPublicSkillSlug({ id: UUID })).toBe(UUID);
    expect(
      getPublicSkillSlug({ id: UUID, public_author_slug: "x", skill_id: "cal" })
    ).toBe("cal");
  });

  it("getPublicSkillAuthorSlug prefers an explicit author slug", () => {
    expect(
      getPublicSkillAuthorSlug({ id: UUID, public_author_slug: "pub" })
    ).toBe("pub");
    expect(getPublicSkillAuthorSlug({ id: UUID })).toBe("publisher-595f5534");
    expect(
      getPublicSkillAuthorSlug({ id: UUID, author_handle: "Andy Sus" })
    ).toBe("andy-sus");
  });

  it("getPublicSkillPath emits chain paths directly and two-segment paths for db ids", () => {
    const chainId = `${CHAIN_SKILL_PREFIX}${UUID.slice(4)}`;
    expect(getPublicSkillPath({ id: chainId })).toBe(`/skills/${chainId}`);
    expect(getPublicSkillPath({ id: UUID })).toBe(
      `/skills/publisher-595f5534/${UUID}`
    );
    expect(getPublicSkillPath({ id: UUID, author_handle: "Andy Sus" })).toBe(
      `/skills/andy-sus/${UUID}`
    );
    expect(
      getPublicSkillPath({
        id: UUID,
        author_handle: "Andy Sus",
        skill_id: "calendar agent",
      })
    ).toBe("/skills/andy-sus/calendar-agent");
  });

  it("getCanonicalSkillRawUrl points at the public /raw endpoint for the db id", () => {
    const url = getCanonicalSkillRawUrl(UUID);
    expect(url).toBe(`${AGENTVOUCH_PUBLIC_ORIGIN}/api/skills/${UUID}/raw`);
    expect(url.endsWith(`/api/skills/${UUID}/raw`)).toBe(true);
    const chainId = `${CHAIN_SKILL_PREFIX}${UUID.slice(4)}`;
    expect(getCanonicalSkillRawUrl(chainId)).toBe(
      `${AGENTVOUCH_PUBLIC_ORIGIN}/api/skills/${chainId}/raw`
    );
  });
});

describe("skillUrls UUID guard", () => {
  it("isUuidLike accepts canonical v4-ish uuids case-insensitively and rejects malformed ids", () => {
    expect(isUuidLike(UUID)).toBe(true);
    expect(isUuidLike(UUID.toUpperCase())).toBe(true);
    // version nibble not in [1-5]
    expect(isUuidLike("595f5534-07ae-0839-a45a-b6858ab731fe")).toBe(false);
    // variant nibble not in [89ab]
    expect(isUuidLike("595f5534-07ae-4839-045a-b6858ab731fe")).toBe(false);
    // no dashes
    expect(isUuidLike("595f553407ae4839a45ab6858ab731fe")).toBe(false);
    expect(isUuidLike("short")).toBe(false);
    expect(isUuidLike("")).toBe(false);
  });
});
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
