import { lookup } from "node:dns/promises";
import { request as requestHttp, type IncomingMessage } from "node:http";
import {
  request as requestHttps,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import { resolveSafeFetchUrl } from "@/lib/safeFetch";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const decompressBrotli = promisify(brotliDecompress);
const decompressGzip = promisify(gunzip);
const decompressDeflate = promisify(inflate);

// Conservative public-destination policy, based on IANA's special-purpose
// registries. Protocol-assignment blocks stay excluded even where individual
// anycast exceptions exist; skill content does not need those destinations.
const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(address, prefix, "ipv4");
}

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
blockedV6.addSubnet("2001::", 23, "ipv6");
blockedV6.addSubnet("2001:db8::", 32, "ipv6");
blockedV6.addSubnet("2002::", 16, "ipv6");
blockedV6.addSubnet("3fff::", 20, "ipv6");

export function isPublicFetchAddress(address: string): boolean {
  // Zone identifiers and IPv4-mapped/translated IPv6 addresses are not allowed.
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  return (
    family === 6 &&
    globalV6.check(address, "ipv6") &&
    !blockedV6.check(address, "ipv6")
  );
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
    if (signal.aborted) {
      signal.removeEventListener("abort", onAbort);
      onAbort();
    }
  });
}

async function readResponse(
  response: IncomingMessage,
  signal: AbortSignal
): Promise<Response> {
  try {
    const status = response.statusCode ?? 502;
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }

    // Redirects are deliberately returned without following them or consuming
    // their bodies. The caller must validate the next URL in its bounded loop.
    if (status < 200 || status > 599) {
      throw new Error("Skill URI fetch rejected: invalid HTTP status");
    }
    if (status >= 300 || status === 204 || status === 205) {
      return new Response(null, { status, headers });
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response) {
      signal.throwIfAborted();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new Error("Skill URI fetch rejected: response exceeds 10 MiB");
      }
      chunks.push(buffer);
    }

    let body: Buffer = Buffer.concat(chunks, bytes);
    const encodings = (headers.get("content-encoding") ?? "identity")
      .toLowerCase()
      .split(",")
      .reverse();
    for (const rawEncoding of encodings) {
      signal.throwIfAborted();
      const encoding = rawEncoding.trim();
      if (encoding === "identity" || encoding === "") continue;
      const decompress =
        encoding === "gzip" || encoding === "x-gzip"
          ? decompressGzip
          : encoding === "deflate"
          ? decompressDeflate
          : encoding === "br"
          ? decompressBrotli
          : null;
      if (!decompress) {
        throw new Error(
          "Skill URI fetch rejected: unsupported content encoding"
        );
      }
      body = await abortable(
        decompress(body, { maxOutputLength: MAX_RESPONSE_BYTES }),
        signal
      );
    }
    signal.throwIfAborted();
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(new Uint8Array(body), { status, headers });
  } finally {
    response.destroy();
  }
}

/** Fetch one public HTTP(S) hop, without a second hostname resolution. */
export async function fetchPublicUrl(input: string): Promise<Response> {
  const safe = resolveSafeFetchUrl(input);
  if (!safe.ok) {
    throw new Error(`Skill URI fetch rejected: ${safe.reason}`);
  }
  const url = new URL(safe.url);
  if (url.username || url.password) {
    throw new Error(
      "Skill URI fetch rejected: URL credentials are not allowed"
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Skill URI fetch timed out")),
    REQUEST_TIMEOUT_MS
  );

  try {
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await abortable(
          lookup(hostname, { all: true, verbatim: true }),
          controller.signal
        );
    if (
      addresses.length === 0 ||
      addresses.some(
        ({ address, family }) =>
          family !== isIP(address) || !isPublicFetchAddress(address)
      )
    ) {
      throw new Error(
        "Skill URI fetch rejected: DNS returned a non-public address"
      );
    }
    // Prefer IPv4 where available; every answer was checked, not only this one.
    const pinned = addresses.find(({ family }) => family === 4) ?? addresses[0];
    controller.signal.throwIfAborted();
    const options: HttpsRequestOptions = {
      // Connect to this numeric address, never the untrusted DNS name. Neither
      // the HTTP client nor redirects can silently perform another lookup.
      hostname: pinned.address,
      family: pinned.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        Host: url.host,
        Accept: "*/*",
        "Accept-Encoding": "gzip, deflate, br",
      },
      agent: false,
      signal: controller.signal,
      servername: literalFamily ? "" : hostname,
      rejectUnauthorized: true,
      checkServerIdentity: (_server, certificate) =>
        checkServerIdentity(hostname, certificate),
    };
    const request = url.protocol === "https:" ? requestHttps : requestHttp;
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = request(options, resolve);
      outgoing.once("error", reject);
      outgoing.once("upgrade", (_response, socket) => {
        socket.destroy();
        reject(new Error("Skill URI fetch rejected: protocol upgrade"));
      });
      outgoing.end();
    });
    return await readResponse(response, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
