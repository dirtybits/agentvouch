---
name: skill-uri-dns-protection
overview: "Reject private DNS answers and pin chain-only skill downloads to validated public addresses."
todos:
  - id: pin-public-destinations
    content: Add the public-address transport and use it for each download redirect hop
    status: completed
  - id: verify-dns-and-download-behavior
    content: Add focused regression coverage and complete the remaining publication checks
    status: in_progress
  - id: publish-reviewed-change
    content: Publish a separate PR after verification and explicit publication approval
    status: in_progress
isProject: false
---

# Block private DNS destinations in skill downloads

## Goal

Prevent an author-controlled skill URI from reaching private addresses through
DNS answers or DNS rebinding. Preserve public HTTP(S) downloads and the existing
five-redirect limit.

## Scope

- In scope: the chain-only raw-download path and its server-side HTTP transport.
- Out of scope: other outbound fetch paths, contract deployments, database changes,
  global proxy configuration, and private network allowlists.

## Files

- `web/lib/publicUrlFetch.server.ts`: classify resolved addresses, reject mixed
  public/private answers, connect to a numeric public address, retain the original
  Host header and TLS certificate identity, and return redirects without following.
- `web/app/api/skills/[id]/raw/route.ts`: use the pinned transport at every hop.
- `web/__tests__/lib/publicUrlFetch.test.ts`: transport regression coverage.
- `web/__tests__/api/skills-raw.test.ts`: transport-boundary mock update.

## Design decisions (2026-09-20)

Use Node HTTP(S) rather than adding a dependency or changing the process-wide
fetch dispatcher. Resolve all OS-provided A/AAAA answers once per hop and reject
the request if any address is outside the public-address policy. Literal IP URLs
use the same address policy without a DNS lookup. Dial the selected numeric IP
directly, so a second DNS answer cannot change the connection destination.

The conservative IPv6 policy permits global unicast outside protocol-assignment,
documentation, and transition blocks. IPv4-mapped and translation addresses are
rejected. Some special-purpose globally reachable anycast addresses are excluded
intentionally; this is a content downloader, not a general network client.

Keep TLS verification enabled and check certificates against the original URL
hostname, not the pinned IP. Do not forward inbound credentials. Each hop has a
15-second DNS/request/body deadline and a 10 MiB encoded/decoded content cap.
Support gzip, deflate, and Brotli content within that cap.

Sources: [Node HTTP request options](https://nodejs.org/docs/latest-v24.x/api/http.html#httprequestoptions-callback),
[Node HTTPS options](https://nodejs.org/docs/latest-v24.x/api/https.html#httpsrequestoptions-callback),
[IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry/),
[IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry/).

## Verification

The user approved focused tests, then explicitly requested broader checks and a PR.
The transport suite uses mocked DNS and sockets, while route tests retain their
access-control and redirect coverage through a transport-boundary mock.

Recorded local results on the PR branch based on main `5299a8ad`:

- Clean root `npm ci --prefer-offline --no-audit --no-fund` completed, including
  the CLI postinstall build, without modifying the primary checkout's dependencies.
- Focused tests: 172 passed across three suites, including 119 new transport tests.
- Formatting, web lint, web typecheck, and whitespace checks passed.
- Full web suite: 1,182 tests passed across 141 files.
- Chain capability check passed: 25 Solana instructions, 22 Base state-changing
  functions, and 26 mapped rows.
- Webpack compilation and its TypeScript step passed. The production build then
  failed prerendering `/sitemap.xml` because `DATABASE_URL` is absent from the
  isolated checkout. No production credentials were copied in to bypass this.
- A configured Vercel preview build remains the outstanding build gate. No live
  external DNS/socket smoke or production deployment was performed.

- Cover private and mixed DNS answers, lookup failure and empty results, public
  IPv4/IPv6, IPv4-mapped IPv6, metadata addresses, and trailing-dot hostnames.
- Assert that the socket target is the checked numeric IP and DNS is called only
  once per hop; verify the original TLS hostname and Host header are retained.
- Cover public redirects, redirects to private DNS targets, same-host rebinding,
  TLS/network errors, timeouts, compression, and content-size limits.
- Run `npm test --workspace @agentvouch/web -- __tests__/lib/publicUrlFetch.test.ts __tests__/lib/safeFetch.test.ts __tests__/api/skills-raw.test.ts` after approval.
- Broader gates before publication: formatting, web lint/typecheck, the full web
  test suite, and `npm exec --workspace @agentvouch/web -- next build --webpack`.
  A missing local dependency previously blocked typecheck; do not change the
  primary checkout's shared dependency installation to bypass that problem.

## Rollout and rollback

The PR is prepared on `codex/skill-uri-dns-protection` in a fresh isolated worktree
from current main. Publication is explicitly approved; remote checks are pending.
No production deployment or primary-checkout update is part of this edit.
If rollout fails, revert only this follow-up patch; retain PR #198's literal-host
and redirect protections. Record any rollback as restoring the known DNS gap.

## Remaining boundaries

Application checks cannot replace network egress controls. Public servers acting
as relays and deployment-specific routes for otherwise public IPs are outside
this DNS-pinning boundary. Blocking addresses does not establish content trust.
