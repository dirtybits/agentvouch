import { describe, expect, it } from "vitest";
import { classifyLicense } from "@/lib/mirror/github";
import type { SkillTreeInputFile } from "@/lib/skillStorage";

function makeFiles(licenseText: string): SkillTreeInputFile[] {
  return [
    { path: "SKILL.md", content: "# hello" },
    { path: "LICENSE", content: licenseText },
  ];
}

describe("classifyLicense", () => {
  it("classifies MIT as permissive", () => {
    const result = classifyLicense(
      makeFiles(
        "MIT License\n\nPermission is hereby granted, free of charge, to any person"
      )
    );
    expect(result.permissive).toBe(true);
    expect(result.tag).toBe("mit");
  });

  it("classifies Apache-2.0 as permissive", () => {
    const result = classifyLicense(
      makeFiles("Apache License\n\nVersion 2\n\nTERMS AND CONDITIONS")
    );
    expect(result.permissive).toBe(true);
    expect(result.tag).toBe("apache-2.0");
  });

  it("classifies BSD as permissive", () => {
    const result = classifyLicense(
      makeFiles(
        "Redistribution and use in source and binary forms, with or without modification"
      )
    );
    expect(result.permissive).toBe(true);
    expect(result.tag).toBe("bsd");
  });

  it("classifies ISC as permissive", () => {
    const result = classifyLicense(
      makeFiles(
        "Permission to use, copy, modify, and/or distribute this software"
      )
    );
    expect(result.permissive).toBe(true);
    expect(result.tag).toBe("isc");
  });

  it("denies proprietary all-rights-reserved text", () => {
    const result = classifyLicense(
      makeFiles("Figma Developer Platform Terms\n\nAll rights reserved.")
    );
    expect(result.permissive).toBe(false);
    expect(result.tag).toBe("all-rights-reserved");
  });

  it("denies MPL-2.0 (non-permissive)", () => {
    const result = classifyLicense(
      makeFiles("Mozilla Public License\n\nVersion 2.0")
    );
    expect(result.permissive).toBe(false);
    expect(result.tag).toBe("mpl-2.0");
  });

  it("denies unknown license text (default-deny)", () => {
    const result = classifyLicense(
      makeFiles("Proprietary software license v3")
    );
    expect(result.permissive).toBe(false);
    expect(result.tag).toBe("unknown");
  });

  it("denies when no license file is present", () => {
    const result = classifyLicense([{ path: "SKILL.md", content: "# hello" }]);
    expect(result.permissive).toBe(false);
    expect(result.tag).toBe(null);
    expect(result.file).toBe(null);
  });
});
