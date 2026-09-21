import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
} from "node:http";
import type { RequestOptions } from "node:https";
import { isIP } from "node:net";
import { PassThrough, Readable } from "node:stream";
import type { PeerCertificate } from "node:tls";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

const network = vi.hoisted(() => ({
  lookup: vi.fn(),
  http: vi.fn(),
  https: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:http", () => ({ request: network.http }));
vi.mock("node:https", () => ({ request: network.https }));

import {
  fetchPublicUrl,
  isPublicFetchAddress,
} from "@/lib/publicUrlFetch.server";

const URI = "https://skills.example/skill.md";
const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:4700:4700::1111";
const CONTENT = "# Skill\nPublic content with UTF-8: \u00e9\n";
const MAX_BYTES = 10 * 1024 * 1024;

type Reply =
  | { response: IncomingMessage }
  | { error: Error }
  | { stall: true }
  | { upgrade: { destroy: ReturnType<typeof vi.fn> } };

const replies: Reply[] = [];

function record(address: string) {
  return { address, family: isIP(address) };
}

function response(
  body: string | Buffer | Readable = CONTENT,
  statusCode = 200,
  headers: IncomingHttpHeaders = {}
): IncomingMessage {
  const stream =
    body instanceof Readable ? body : Readable.from([Buffer.from(body)]);
  return Object.assign(stream, { statusCode, headers }) as IncomingMessage;
}

// Exercise the real DNS/address/response code without allowing real sockets.
// The fake request also propagates AbortSignal to pending headers and bodies.
function request(
  options: RequestOptions,
  onResponse: (incoming: IncomingMessage) => void
): ClientRequest {
  const reply = replies.shift();
  if (!reply) throw new Error("Unexpected request without a network fixture");
  const outgoing = new EventEmitter();
  const removeAbort = () =>
    options.signal?.removeEventListener("abort", onAbort);
  const onAbort = () => {
    removeAbort();
    const error = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
      code: "ABORT_ERR",
      cause: options.signal?.reason,
    });
    if ("response" in reply) reply.response.destroy(error);
    outgoing.emit("error", error);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if ("response" in reply) reply.response.once("close", removeAbort);

  return Object.assign(outgoing, {
    end: vi.fn(() => {
      queueMicrotask(() => {
        if (options.signal?.aborted) {
          onAbort();
        } else if ("response" in reply) {
          onResponse(reply.response);
        } else if ("error" in reply) {
          removeAbort();
          outgoing.emit("error", reply.error);
        } else if ("upgrade" in reply) {
          removeAbort();
          outgoing.emit("upgrade", {}, reply.upgrade);
        }
      });
      return outgoing;
    }),
  }) as unknown as ClientRequest;
}

function expectNoRequest() {
  expect(network.http).not.toHaveBeenCalled();
  expect(network.https).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  replies.length = 0;
  network.lookup.mockResolvedValue([record(PUBLIC_V4)]);
  network.http.mockImplementation(request);
  network.https.mockImplementation(request);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected unpinned global fetch"))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isPublicFetchAddress", () => {
  it.each([
    "1.1.1.1",
    "8.8.8.8",
    PUBLIC_V4,
    "100.63.255.255",
    "100.128.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
    PUBLIC_V6,
    "2001:4860:4860::8888",
    "2a00:1450:4001:81b::200e",
  ])("allows public address %s", (address) => {
    expect(isPublicFetchAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.169.254",
    "172.16.0.0",
    "172.31.255.255",
    "192.0.0.9",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.0",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "100::1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "2001::1",
    "2001:2::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "3fff::1",
    "2606:4700:4700::1111%lo0",
    "",
    "skills.example",
    "127.1",
    "0x7f000001",
    "999.1.1.1",
  ])("rejects non-public or invalid address %s", (address) => {
    expect(isPublicFetchAddress(address)).toBe(false);
  });
});

describe("fetchPublicUrl DNS and connection boundary", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::1",
  ])(
    "rejects a public hostname resolving to %s before opening a socket",
    async (address) => {
      network.lookup.mockResolvedValue([record(address)]);
      await expect(fetchPublicUrl(URI)).rejects.toThrow(
        "DNS returned a non-public address"
      );
      expect(network.lookup).toHaveBeenCalledWith("skills.example", {
        all: true,
        verbatim: true,
      });
      expectNoRequest();
    }
  );

  it.each([
    [PUBLIC_V4, "10.0.0.1"],
    ["10.0.0.1", PUBLIC_V4],
    [PUBLIC_V4, "fd00::1"],
    [PUBLIC_V6, "169.254.169.254"],
  ])("rejects mixed DNS answers %s and %s", async (first, second) => {
    network.lookup.mockResolvedValue([record(first), record(second)]);
    await expect(fetchPublicUrl(URI)).rejects.toThrow("non-public address");
    expectNoRequest();
  });

  it.each([
    { addresses: [] },
    { addresses: [{ address: PUBLIC_V4, family: 6 }] },
    { addresses: [{ address: PUBLIC_V6, family: 4 }] },
    { addresses: [{ address: "not-an-address", family: 4 }] },
  ])(
    "fails closed on empty or malformed DNS answers %#",
    async ({ addresses }) => {
      network.lookup.mockResolvedValue(addresses);
      await expect(fetchPublicUrl(URI)).rejects.toThrow("non-public address");
      expectNoRequest();
    }
  );

  it("propagates DNS failures without attempting a fallback fetch", async () => {
    network.lookup.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    await expect(fetchPublicUrl(URI)).rejects.toThrow("ENOTFOUND");
    expectNoRequest();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pins the socket to the checked IPv4 address and retains HTTPS identity", async () => {
    network.lookup
      .mockResolvedValueOnce([record(PUBLIC_V6), record(PUBLIC_V4)])
      .mockResolvedValue([record("127.0.0.1")]);
    replies.push({ response: response() });
    const result = await fetchPublicUrl(
      "https://skills.example:8443/a.md?q=1#section"
    );
    expect(await result.text()).toBe(CONTENT);
    expect(network.lookup).toHaveBeenCalledTimes(1);
    expect(network.https).toHaveBeenCalledTimes(1);
    const options = network.https.mock.calls[0][0] as RequestOptions;
    expect(options).toMatchObject({
      hostname: PUBLIC_V4,
      family: 4,
      port: "8443",
      path: "/a.md?q=1",
      method: "GET",
      agent: false,
      servername: "skills.example",
      rejectUnauthorized: true,
      headers: { Host: "skills.example:8443" },
    });
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(
      options.checkServerIdentity?.(PUBLIC_V4, {
        subjectaltname: "DNS:skills.example",
      } as PeerCertificate)
    ).toBeUndefined();
    expect(
      options.checkServerIdentity?.(PUBLIC_V4, {
        subjectaltname: "DNS:attacker.example",
      } as PeerCertificate)
    ).toBeInstanceOf(Error);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports a public IPv6-only DNS answer", async () => {
    network.lookup.mockResolvedValue([record(PUBLIC_V6)]);
    replies.push({ response: response() });
    expect(await (await fetchPublicUrl(URI)).text()).toBe(CONTENT);
    expect(network.https.mock.calls[0][0]).toMatchObject({
      hostname: PUBLIC_V6,
      family: 6,
      servername: "skills.example",
    });
  });

  it.each([
    ["http://8.8.8.8/skill.md", "8.8.8.8", 4],
    [`http://[${PUBLIC_V6}]/skill.md`, PUBLIC_V6, 6],
  ])(
    "applies address policy to literal URL %s without DNS",
    async (url, address, family) => {
      replies.push({ response: response() });
      expect(await (await fetchPublicUrl(String(url))).text()).toBe(CONTENT);
      expect(network.lookup).not.toHaveBeenCalled();
      expect(network.https).not.toHaveBeenCalled();
      expect(network.http.mock.calls[0][0]).toMatchObject({
        hostname: address,
        family,
        port: 80,
        servername: "",
      });
    }
  );

  it("canonicalizes a trailing-dot DNS name before lookup and TLS checks", async () => {
    replies.push({ response: response() });
    await fetchPublicUrl("https://skills.example./skill.md");
    expect(network.lookup).toHaveBeenCalledWith("skills.example", {
      all: true,
      verbatim: true,
    });
    expect(network.https.mock.calls[0][0]).toMatchObject({
      servername: "skills.example",
      headers: { Host: "skills.example." },
    });
  });

  it.each([
    "http://127.0.0.1/private",
    "http://2130706433/private",
    "http://localhost./private",
    "http://[::1]/private",
    "file:///etc/passwd",
    "gopher://skills.example/",
    "https://user:secret@skills.example/skill.md",
  ])("rejects unsafe URL %s before DNS or HTTP", async (url) => {
    await expect(fetchPublicUrl(url)).rejects.toThrow(
      "Skill URI fetch rejected"
    );
    expect(network.lookup).not.toHaveBeenCalled();
    expectNoRequest();
  });
});

describe("redirect-hop DNS validation", () => {
  it.each([301, 302, 303, 307, 308])(
    "returns %i without automatically following it",
    async (status) => {
      const incoming = response(new PassThrough(), status, {
        location: "/next.md",
      });
      replies.push({ response: incoming });
      const result = await fetchPublicUrl(URI);
      expect(result.status).toBe(status);
      expect(result.headers.get("location")).toBe("/next.md");
      expect(result.body).toBeNull();
      expect(incoming.destroyed).toBe(true);
      expect(network.lookup).toHaveBeenCalledTimes(1);
      expect(network.https).toHaveBeenCalledTimes(1);
    }
  );

  it("allows public redirect hops, resolving and pinning each destination", async () => {
    network.lookup
      .mockResolvedValueOnce([record(PUBLIC_V4)])
      .mockResolvedValueOnce([record("1.1.1.1")]);
    replies.push(
      {
        response: response("", 302, {
          location: "https://cdn.example/next.md",
        }),
      },
      { response: response() }
    );
    const first = await fetchPublicUrl(URI);
    const next = new URL(first.headers.get("location")!, URI).href;
    expect(await (await fetchPublicUrl(next)).text()).toBe(CONTENT);
    expect(network.lookup.mock.calls.map(([host]) => host)).toEqual([
      "skills.example",
      "cdn.example",
    ]);
    expect(
      network.https.mock.calls.map(([options]) => options.hostname)
    ).toEqual([PUBLIC_V4, "1.1.1.1"]);
  });

  it.each(["/next.md", "https://internal.example/next.md"])(
    "rejects private DNS on redirect %s, including same-host rebinding",
    async (location) => {
      network.lookup
        .mockResolvedValueOnce([record(PUBLIC_V4)])
        .mockResolvedValueOnce([record("169.254.169.254")]);
      replies.push({ response: response("", 302, { location }) });
      const first = await fetchPublicUrl(URI);
      const next = new URL(first.headers.get("location")!, URI).href;
      await expect(fetchPublicUrl(next)).rejects.toThrow("non-public address");
      expect(network.lookup).toHaveBeenCalledTimes(2);
      expect(network.https).toHaveBeenCalledTimes(1);
      expect(network.http).not.toHaveBeenCalled();
    }
  );
});

describe("response handling and cleanup", () => {
  it.each([
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ] as const)(
    "decodes %s content and removes stale encoding/length headers",
    async (encoding, compress) => {
      const body = compress(Buffer.from(CONTENT));
      const incoming = response(body, 200, {
        "content-encoding": encoding,
        "content-length": String(body.length),
        "content-type": "text/markdown",
      });
      replies.push({ response: incoming });
      const result = await fetchPublicUrl(URI);
      expect(await result.text()).toBe(CONTENT);
      expect(result.headers.get("content-encoding")).toBeNull();
      expect(result.headers.get("content-length")).toBeNull();
      expect(result.headers.get("content-type")).toBe("text/markdown");
      expect(incoming.destroyed).toBe(true);
    }
  );

  it("decodes stacked content encodings in reverse order", async () => {
    replies.push({
      response: response(
        brotliCompressSync(gzipSync(Buffer.from(CONTENT))),
        200,
        { "content-encoding": "gzip, br" }
      ),
    });
    expect(await (await fetchPublicUrl(URI)).text()).toBe(CONTENT);
  });

  it.each([204, 205, 304, 404, 500])(
    "returns status %i without consuming its body",
    async (status) => {
      const incoming = response(new PassThrough(), status);
      replies.push({ response: incoming });
      const result = await fetchPublicUrl(URI);
      expect(result.status).toBe(status);
      expect(result.body).toBeNull();
      expect(incoming.destroyed).toBe(true);
    }
  );

  it("rejects encoded bodies larger than 10 MiB and destroys the stream", async () => {
    const incoming = response(Buffer.alloc(MAX_BYTES + 1));
    replies.push({ response: incoming });
    await expect(fetchPublicUrl(URI)).rejects.toThrow(
      "response exceeds 10 MiB"
    );
    expect(incoming.destroyed).toBe(true);
  });

  it("rejects compressed bodies that expand beyond 10 MiB", async () => {
    const incoming = response(gzipSync(Buffer.alloc(MAX_BYTES + 1)), 200, {
      "content-encoding": "gzip",
    });
    replies.push({ response: incoming });
    await expect(fetchPublicUrl(URI)).rejects.toThrow();
    expect(incoming.destroyed).toBe(true);
  });

  it.each(["compress", "unknown"])(
    "rejects unsupported encoding %s",
    async (encoding) => {
      replies.push({
        response: response(CONTENT, 200, { "content-encoding": encoding }),
      });
      await expect(fetchPublicUrl(URI)).rejects.toThrow(
        "unsupported content encoding"
      );
    }
  );

  it("propagates corrupt compressed-content errors", async () => {
    replies.push({
      response: response("not gzip", 200, { "content-encoding": "gzip" }),
    });
    await expect(fetchPublicUrl(URI)).rejects.toThrow();
  });

  it.each(["ECONNREFUSED", "certificate has expired"])(
    "propagates network/TLS error %s without fallback",
    async (message) => {
      replies.push({ error: new Error(message) });
      await expect(fetchPublicUrl(URI)).rejects.toThrow(message);
      expect(network.https).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("rejects a body stream failure and destroys the response", async () => {
    const incoming = response(
      Readable.from(
        (async function* () {
          yield Buffer.from("partial");
          throw new Error("connection reset during body");
        })()
      )
    );
    replies.push({ response: incoming });
    await expect(fetchPublicUrl(URI)).rejects.toThrow(
      "connection reset during body"
    );
    expect(incoming.destroyed).toBe(true);
  });

  it("rejects protocol upgrades and closes the upgraded socket", async () => {
    const socket = { destroy: vi.fn() };
    replies.push({ upgrade: socket });
    await expect(fetchPublicUrl(URI)).rejects.toThrow("protocol upgrade");
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("bounds a stalled DNS lookup to 15 seconds", async () => {
    vi.useFakeTimers();
    network.lookup.mockImplementation(() => new Promise(() => {}));
    const rejected = expect(fetchPublicUrl(URI)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expectNoRequest();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["headers", "body"])(
    "aborts stalled %s and clears its deadline",
    async (stage) => {
      vi.useFakeTimers();
      const incoming = response(new PassThrough());
      replies.push(
        stage === "headers" ? { stall: true } : { response: incoming }
      );
      const rejected = expect(fetchPublicUrl(URI)).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      const options = network.https.mock.calls[0][0] as RequestOptions;
      expect(options.signal?.aborted).toBe(true);
      if (stage === "body") expect(incoming.destroyed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
