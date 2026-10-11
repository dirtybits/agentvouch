import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram, parseUsdcAmount } from "../src/cli.js";
import { formatCreateVouchResult } from "../src/lib/format.js";

function captureHelp(command: Command): string {
  let captured = "";
  command.configureOutput({
    writeOut: (s) => {
      captured += s;
    },
    writeErr: () => {},
    outputError: () => {},
  });
  command.outputHelp();
  return captured;
}

describe("vouch command tree", () => {
  const program = buildProgram();
  const vouch = program.commands.find((c) => c.name() === "vouch");

  it("registers a top-level vouch command with a create subcommand", () => {
    expect(vouch).toBeDefined();
    const subs = vouch!.commands.map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(["create"]));
  });

  it("surfaces the required options and example in vouch create --help", () => {
    const create = vouch!.commands.find((c) => c.name() === "create")!;
    const help = captureHelp(create);
    expect(help).toContain("--author");
    expect(help).toContain("--amount-usdc");
    expect(help).toContain("--keypair");
    expect(help).toContain("agentvouch vouch create --author");
  });
});

describe("parseUsdcAmount", () => {
  it("converts positive amounts to exact micro-USDC", () => {
    expect(parseUsdcAmount("0.000001")).toBe("1");
    expect(parseUsdcAmount("0.1")).toBe("100000");
    expect(parseUsdcAmount("1")).toBe("1000000");
    expect(parseUsdcAmount("3.5")).toBe("3500000");
    expect(parseUsdcAmount(" 1.234567 ")).toBe("1234567");
  });

  it("rejects zero and malformed or over-precise amounts", () => {
    for (const input of [
      "0",
      "0.000000",
      "-1",
      "not-a-number",
      "",
      "   ",
      ".1",
      "1.",
      "1e2",
      "1.0000001",
    ]) {
      expect(() => parseUsdcAmount(input), input).toThrow(
        /positive USDC amount/
      );
    }
  });
});

describe("formatCreateVouchResult", () => {
  it("omits stake amount and tx when the vouch already exists", () => {
    const lines = formatCreateVouchResult({
      vouch: "PDAvouch",
      alreadyExists: true,
    });

    expect(lines).toContain("vouch: PDAvouch");
    expect(lines).toContain("already_exists: yes");
    expect(lines.some((l) => l.startsWith("stake_usdc_micros:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("tx:"))).toBe(false);
  });

  it("emits USDC stake and tx on a fresh vouch", () => {
    const lines = formatCreateVouchResult({
      vouch: "PDAvouch",
      alreadyExists: false,
      stakeUsdcMicros: 1_000_000,
      tx: "txsig",
    });

    expect(lines).toContain("already_exists: no");
    expect(lines).toContain("stake_usdc_micros: 1000000");
    expect(lines).toContain("tx: txsig");
  });
});
