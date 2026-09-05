import fs from "node:fs/promises";
import path from "node:path";
import { compile } from "@tailwindcss/node";
import { beforeAll, describe, expect, it } from "vitest";

describe("semantic typography utilities", () => {
  const cases = [
    ["hover:font-title", "--font-crimson-pro"],
    ["prose-headings:font-display", "--font-crimson-pro"],
    ["hover:font-sans", "--font-inter"],
    ["hover:font-mono", "--font-inconsolata"],
  ] as const;
  let css: string;

  beforeAll(async () => {
    const stylesheet = path.join(process.cwd(), "app/globals.css");
    const compiler = await compile(await fs.readFile(stylesheet, "utf8"), {
      base: path.dirname(stylesheet),
      onDependency: () => {},
    });
    css = compiler.build(cases.map(([utility]) => utility));
  });

  it.each(cases)("generates %s using %s", (utility, fontVariable) => {
    // Compile real variants: plain CSS classes alone cannot provide these.
    const selector = `.${utility.replace(":", "\\:")}`;
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const declaration = css.slice(start).match(/font-family:\s*([^;]+);/);
    expect(declaration?.[1]).toContain(`var(${fontVariable})`);
  });
});
