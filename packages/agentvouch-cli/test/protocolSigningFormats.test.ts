import { describe, expect, it } from "vitest";

import {
  AGENTVOUCH_DEFAULT_BASE_URL,
  AGENTVOUCH_DEFAULT_RPC_URL,
  AGENTVOUCH_PROGRAM_ID,
  AGENTVOUCH_SOLANA_CHAIN_CONTEXT,
  AUTH_PAYLOAD_MAX_AGE_MS,
  buildDownloadRawMessage,
  buildSignMessage,
  normalizeProtocolNewlines,
} from "@agentvouch/protocol";

// These are the canonical signed-message formats that the CLI signs and the
// web server verifies. Drift between the `@agentvouch/protocol` package and any
// mirror (web/lib/authPayload.ts, web/app/..., CLI signer) silently accepts or
// rejects signatures, so the exact literal byte format is the contract this test
// pins. No network, no chain — pure string builders and protocol constants.

describe("buildSignMessage (repo auth)", () => {
  it("renders the exact Action+Timestamp body", () => {
    const message = buildSignMessage("publish-skill", 1_709_234_567_890);
    expect(message).toBe(
      "AgentVouch Skill Repo\nAction: publish-skill\nTimestamp: 1709234567890"
    );
  });

  it("uses the exact header line for every action", () => {
    for (const action of ["publish-skill", "connect-repo", "sync-repo"]) {
      expect(buildSignMessage(action, 1)).toContain(
        "AgentVouch Skill Repo\nAction: "
      );
      expect(buildSignMessage(action, 1)).toContain(`\nTimestamp: 1`);
    }
  });
});

describe("buildDownloadRawMessage (paid raw download)", () => {
  it("renders the canonical listing PDA format", () => {
    const message = buildDownloadRawMessage(
      "595f5534-07ae-4839-a45a-b6858ab731fe",
      "37Mm4DzMockListing",
      1_709_234_567_891
    );
    expect(message).toBe(
      "AgentVouch Skill Download\nAction: download-raw\n" +
        "Skill id: 595f5534-07ae-4839-a45a-b6858ab731fe\n" +
        "Listing: 37Mm4DzMockListing\n" +
        "Timestamp: 1709234567891"
    );
  });

  it.each([undefined, null])(
    "falls back to the x402-usdc-direct scope for $0",
    (listing) => {
      const message = buildDownloadRawMessage(
        "skill-db-id",
        listing,
        1_709_234_567_892
      );
      expect(message).toContain("Listing: x402-usdc-direct");
      expect(message).not.toContain("Listing: null");
      expect(message).not.toContain("Listing: undefined");
    }
  );

  it("never emits a null or undefined listing string", () => {
    const message = buildDownloadRawMessage("skill-db-id", null, 1);
    expect(
      message.split("\n").some((line) => /null|undefined/.test(line))
    ).toBe(false);
  });
});

describe("normalizeProtocolNewlines", () => {
  it("normalizes CRLF to LF", () => {
    expect(normalizeProtocolNewlines("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("leaves lone LFs and other control chars alone", () => {
    expect(normalizeProtocolNewlines("a\nb")).toBe("a\nb");
    expect(normalizeProtocolNewlines("a\rb")).toBe("a\rb");
    expect(normalizeProtocolNewlines("a \n b")).toBe("a \n b");
  });

  it("handles empty input", () => {
    expect(normalizeProtocolNewlines("")).toBe("");
  });
});

describe("protocol constants (client/server contract)", () => {
  it("exposes a stable program ID", () => {
    expect(AGENTVOUCH_PROGRAM_ID).toBe(
      "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg"
    );
  });

  it("exposes the CAIP-2 Solana chain context", () => {
    expect(AGENTVOUCH_SOLANA_CHAIN_CONTEXT).toBe(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    );
  });

  it("exposes a positive auth-payload age ceiling", () => {
    expect(AUTH_PAYLOAD_MAX_AGE_MS).toBeGreaterThan(0);
    expect(Number.isInteger(AUTH_PAYLOAD_MAX_AGE_MS)).toBe(true);
  });

  it("exposes sane default base + RPC endpoints", () => {
    expect(AGENTVOUCH_DEFAULT_BASE_URL).toBe("https://agentvouch.xyz");
    expect(AGENTVOUCH_DEFAULT_RPC_URL).toBe("https://api.devnet.solana.com");
  });
});
