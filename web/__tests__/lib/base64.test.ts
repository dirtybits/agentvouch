import { describe, expect, it } from "vitest";

import { decodeBase64, encodeBase64 } from "@/lib/base64";

// Helper that builds a deterministic pseudo-random Uint8Array.
function makeBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31) % 256;
  return out;
}

// A reference encoder/decoder that must always be byte-correct. Buffer is the
// canonical reference here; the btoa/atot path in the implementation must agree
// with it or roundtrips would corrupt signatures/transactions.
function referenceEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("base64 encode/decode", () => {
  it("encodes empty bytes to the empty string", () => {
    expect(encodeBase64(new Uint8Array(0))).toBe("");
  });

  it("roundtrips known byte values through decodeBase64", () => {
    const values = [
      new Uint8Array(0),
      new Uint8Array([0x01]),
      new Uint8Array([0x00, 0xff, 0x80]),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    ];
    for (const bytes of values) {
      const encoded = encodeBase64(bytes);
      const decoded = decodeBase64(encoded);
      expect(decoded).toHaveLength(bytes.length);
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    }
  });

  it("keeps the encode path byte-identical to the Buffer reference", () => {
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array([0x01]),
      new Uint8Array([0x00, 0xff, 0x80]),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      makeBytes(1_000),
      makeBytes(10_000),
    ]) {
      expect(encodeBase64(bytes)).toBe(referenceEncode(bytes));
    }
  });

  // The 0x8000 constant exists so the btoa path spreads at most 0x8000 code
  // units per String.fromCharCode call (arg limit 65536). Pin sizes both at
  // and past the boundary so the chunking loop can't silently reground.
  const chunkBoundary = 0x8000;

  it("roundtrips across the 0x8000 string-chunk boundary", () => {
    for (const length of [
      chunkBoundary - 1,
      chunkBoundary,
      chunkBoundary + 1,
      chunkBoundary + 0x7fff,
      0x9000,
      0x12000,
    ]) {
      const bytes = makeBytes(length);
      const encoded = encodeBase64(bytes);
      const decoded = decodeBase64(encoded);

      expect(encodeBase64(bytes)).toBe(referenceEncode(bytes));
      expect(decoded).toHaveLength(length);
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    }
  });

  it("agrees across the btoa and Buffer fallback branches", () => {
    const bytes = makeBytes(2048);
    const withBtoa = encodeBase64(bytes);

    // Force the Buffer fallback branch by hiding btoa.
    const hiddenBtoa = globalThis.btoa;
    globalThis.btoa = undefined as never;
    try {
      const withoutBtoa = encodeBase64(bytes);
      expect(withoutBtoa).toBe(withBtoa);
      expect(withBtoa).toBe(referenceEncode(bytes));
    } finally {
      globalThis.btoa = hiddenBtoa;
    }
  });
});
