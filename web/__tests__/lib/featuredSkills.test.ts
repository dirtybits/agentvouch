import { describe, expect, it } from "vitest";
import { isTestFixtureSkill, selectFeaturedSkills } from "@/lib/featuredSkills";

// Real listing shapes from the devnet marketplace (2026-11-03).
const realSkills = [
  {
    skill_id: "subagent-orchestration",
    name: "Subagent Orchestration",
    tags: ["agents", "workflow"],
  },
  {
    skill_id: "skills-organization",
    name: "Skills Organization",
    tags: ["skills"],
  },
  {
    skill_id: "agent-skills-tree-smoke-20260531-6748",
    name: "Agent Skills Tree Smoke",
    tags: ["smoke", "agent-skills"],
  },
  {
    skill_id: "ethereum-development",
    name: "Ethereum Development",
    tags: ["mit"],
  },
  {
    skill_id: "kora-paid-alpha-20260624",
    name: "Kora Paid Test Alpha",
    tags: ["test", "kora", "paid"],
  },
  { skill_id: "author-cta-mpary18x", name: "Author CTA Smoke", tags: [] },
];

describe("isTestFixtureSkill", () => {
  it("flags fixture tags case-insensitively", () => {
    expect(isTestFixtureSkill({ tags: ["Smoke"] })).toBe(true);
    expect(isTestFixtureSkill({ tags: [" test "] })).toBe(true);
    expect(isTestFixtureSkill({ tags: ["fixture"] })).toBe(true);
  });

  it("flags a whole-word smoke/fixture in the name or slug", () => {
    expect(isTestFixtureSkill({ name: "Author CTA Smoke", tags: [] })).toBe(
      true
    );
    expect(isTestFixtureSkill({ skill_id: "x-smoke-1" })).toBe(true);
  });

  it("does not flag real skills that only contain the letters", () => {
    expect(
      isTestFixtureSkill({ name: "Testing Strategy", tags: ["testing"] })
    ).toBe(false);
    expect(isTestFixtureSkill({ skill_id: "smokestack-monitor" })).toBe(false);
    expect(isTestFixtureSkill({ name: "Contest helper", tags: null })).toBe(
      false
    );
  });
});

describe("selectFeaturedSkills", () => {
  it("skips fixtures and keeps ranking order", () => {
    expect(selectFeaturedSkills(realSkills, 3).map((s) => s.skill_id)).toEqual([
      "subagent-orchestration",
      "skills-organization",
      "ethereum-development",
    ]);
  });

  it("returns fewer than the limit instead of backfilling fixtures", () => {
    expect(selectFeaturedSkills(realSkills.slice(2, 5), 3)).toEqual([
      realSkills[3],
    ]);
  });
});
