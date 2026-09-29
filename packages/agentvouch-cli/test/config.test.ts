import { describe, expect, it } from "vitest";
import { resolveBaseUrl, resolveRpcUrl } from "../src/lib/config.js";
import {
  AGENTVOUCH_DEFAULT_BASE_URL,
  AGENTVOUCH_DEFAULT_RPC_URL,
} from "@agentvouch/protocol";

// Every CLI command routes through these two helpers, so a blank/whitespace
// "explicit" value must degrade to the env/default fallback rather than
// becoming an empty string that breaks every subsequent API/RPC call.

type EnvOverrides = Record<string, string | undefined>;

// Save only the keys we touch, and restore each one in the exact original
// state (present vs deleted) so no test leaks state into another.
function withEnv(overrides: EnvOverrides, fn: () => void): void {
  const snapshot: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    snapshot[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, prev] of Object.entries(snapshot)) {
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}

describe("CLI config resolution", () => {
  describe("resolveBaseUrl", () => {
    it("uses the protocol default when nothing is supplied", () => {
      withEnv({}, () => {
        expect(resolveBaseUrl()).toBe(AGENTVOUCH_DEFAULT_BASE_URL);
      });
    });

    it("uses the protocol default when the explicit url is blank or whitespace-only", () => {
      withEnv({}, () => {
        expect(resolveBaseUrl("")).toBe(AGENTVOUCH_DEFAULT_BASE_URL);
        expect(resolveBaseUrl("   ")).toBe(AGENTVOUCH_DEFAULT_BASE_URL);
        expect(resolveBaseUrl("\t")).toBe(AGENTVOUCH_DEFAULT_BASE_URL);
        expect(resolveBaseUrl("\n")).toBe(AGENTVOUCH_DEFAULT_BASE_URL);
      });
    });

    it("uses the env when the explicit url is blank", () => {
      withEnv({ AGENTVOUCH_BASE_URL: "https://env.example" }, () => {
        expect(resolveBaseUrl("")).toBe("https://env.example");
        expect(resolveBaseUrl("   ")).toBe("https://env.example");
      });
    });

    it("prefers an explicit url over the env when both are present", () => {
      withEnv({ AGENTVOUCH_BASE_URL: "https://env.example" }, () => {
        expect(resolveBaseUrl("https://explicit.example")).toBe(
          "https://explicit.example"
        );
      });
    });

    it("keeps a well-formed url, trimming surrounding whitespace and trailing slashes", () => {
      withEnv({}, () => {
        expect(resolveBaseUrl("  https://agentvouch.example/  ")).toBe(
          "https://agentvouch.example"
        );
        expect(resolveBaseUrl("https://agentvouch.example///")).toBe(
          "https://agentvouch.example"
        );
      });
    });
  });

  describe("resolveRpcUrl", () => {
    it("uses the protocol default when nothing is supplied", () => {
      withEnv({}, () => {
        expect(resolveRpcUrl()).toBe(AGENTVOUCH_DEFAULT_RPC_URL);
      });
    });

    it("uses the protocol default when the explicit rpc is blank or whitespace-only", () => {
      withEnv({}, () => {
        expect(resolveRpcUrl("")).toBe(AGENTVOUCH_DEFAULT_RPC_URL);
        expect(resolveRpcUrl("   ")).toBe(AGENTVOUCH_DEFAULT_RPC_URL);
        expect(resolveRpcUrl("\n\r\t")).toBe(AGENTVOUCH_DEFAULT_RPC_URL);
      });
    });

    it("falls through to the env chain when the explicit rpc is whitespace-only", () => {
      withEnv({ AGENTVOUCH_RPC_URL: "https://env.example" }, () => {
        expect(resolveRpcUrl("   ")).toBe("https://env.example");
        expect(resolveRpcUrl("\t")).toBe("https://env.example");
      });
    });

    it("prefers the AGENTVOUCH_RPC_URL env over ANCHOR_PROVIDER_URL", () => {
      withEnv(
        {
          AGENTVOUCH_RPC_URL: "https://env.example",
          ANCHOR_PROVIDER_URL: "https://anchor.example",
        },
        () => {
          expect(resolveRpcUrl("")).toBe("https://env.example");
        }
      );
    });

    it("uses ANCHOR_PROVIDER_URL when AGENTVOUCH_RPC_URL is unset", () => {
      withEnv({ ANCHOR_PROVIDER_URL: "https://anchor.example" }, () => {
        expect(resolveRpcUrl("")).toBe("https://anchor.example");
      });
    });

    it("prefers an explicit rpc over the env when both are present", () => {
      withEnv({ AGENTVOUCH_RPC_URL: "https://env.example" }, () => {
        expect(resolveRpcUrl("https://explicit.example")).toBe(
          "https://explicit.example"
        );
      });
    });

    it("keeps a well-formed rpc url, trimming surrounding whitespace", () => {
      withEnv({}, () => {
        expect(resolveRpcUrl("  https://rpc.example  ")).toBe(
          "https://rpc.example"
        );
      });
    });
  });
});
