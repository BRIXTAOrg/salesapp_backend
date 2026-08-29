# BRIXTA Server Safety Standard V1

This document defines release-blocking resource, security, tenant-isolation,
and abuse-resistance requirements for salesman_cms and salesapp_backend.

The purpose is not to prevent complex BRIXTA applications. The purpose is to
bound the amount of CPU, RAM, database work, network work and renderer work
that one request, one user, one published Responsibility, or one malformed
document can manufacture.

## 1. Secret handling

- No `.env`, `.env.local`, `.env.production`, credential dump, private key,
  service-role key or password file may be tracked in Git.
- `.env.example` may contain names only, never real values.
- A secret that has ever entered a public repository must be considered
  compromised and rotated. Deleting the current file is not sufficient because
  Git history retains old blobs.
- Logs must not contain passwords, bearer tokens, JWTs, database URLs,
  service-role keys or admin service secrets.
- CI should perform secret scanning.

## 2. Authentication

- Passwords must never be stored reversibly or as plaintext.
- New and migrated passwords must use bcrypt cost >= 12, Argon2id, or an
  equivalent approved password KDF.
- Login errors must not reveal whether tenant/user/password separately exists.
- Login endpoints: max 5 attempts/minute per IP + tenant + identifier.
- Signup/provisioning: max 3 attempts/hour/IP unless an authenticated internal
  provisioning channel is used.
- JWT signing secret must be >= 256 bits of random entropy.
- JWT verification must explicitly allow the intended algorithm.
- Admin service secrets must use constant-time comparison.

## 3. HTTP request budgets

- Normal JSON request body: <= 2 MiB.
- Any endpoint requiring more must declare an explicit route-specific budget.
- Query string: <= 8 KiB.
- Request headers: <= 16 KiB.
- Upstream/internal HTTP deadline: <= 15 seconds.
- Mobile/API JSON response: <= 8 MiB.
- Proxy response bodies must be bounded before complete buffering/parsing.

## 4. Rate limits

Minimum baseline:

- login: 5/minute/IP+identity
- signup/provisioning: 3/hour/IP
- authenticated mobile reads: 120/minute/user
- authenticated writes: 60/minute/user
- CMS admin writes: 60/minute/admin
- media uploads: 10/minute/user

Rate limits should support a small burst but must not allow unbounded bursts.

## 5. Media

- Normal media upload hard ceiling: 8 MiB/file.
- MIME allowlist required.
- File signature/magic-byte verification required for trusted media classes.
- User-controlled uploads should stream to storage or use bounded temporary
  storage rather than retaining the entire file in Node heap.
- Concurrent media operations must be bounded.
- Sensitive evidence must not automatically become globally public.

## 6. Database

- Tenant schema identifiers must match:
  `^[a-z][a-z0-9_]{0,62}$`
- Tenant schema switching must occur inside a transaction using SET LOCAL.
- DB connection acquisition deadline <= 10 seconds.
- DB statement deadline <= 15 seconds.
- Backend pool <= 15 connections unless capacity planning explicitly proves
  a larger budget.
- No unbounded table scans or user-controlled LIMIT values.
- Runtime data-source output <= 500 rows/request.
- Internal pre-filter scans should remain explicitly bounded.
- No unbounded Promise.all over user-controlled collections.

## 7. Published Responsibility renderer envelope

The CMS and backend MUST reject invalid documents at publish/write time using
the same or stricter envelope as the mobile client.

- serialized BRIXTA blocks <= 10,000
- root IDs <= 256
- graph depth <= 64
- direct children/block <= 2,048
- expanded render occurrences <= 4,096

Animation:

- <= 512 animated occurrences: normal
- 513..1,024: allowed only if mobile static-motion fallback is acceptable
- > 1,024: reject publication

Raw STAC:

- nodes/raw subtree <= 2,048
- expanded raw nodes <= 4,096
- depth <= 32
- direct Map/List fanout <= 256
- serialized raw STAC <= 512 KiB

Invalid render payloads must never be published merely because the phone can
later reject them.

## 8. Logic/kernel envelope

BRIXTA may express arbitrary business logic, but a single published
Responsibility cannot manufacture unbounded runtime work.

Initial V1 ceilings:

- actors <= 512
- objects <= 512
- contexts <= 512
- states <= 1,024
- events <= 1,000
- rules <= 2,000
- conditions/group <= 256
- effects/action or event <= 256
- binding/path expression <= 512 characters
- user-controlled filter list <= 20
- evaluation arrays must be bounded before map/filter/flatMap operations

Large applications should be decomposed into multiple Responsibilities rather
than increasing per-request computational infinity.

## 9. CORS / browser security

- Production CORS must use an explicit allowlist.
- Cookie-authenticated CMS mutations require Origin/CSRF protection.
- Security headers should include at least:
  X-Content-Type-Options, Referrer-Policy, frame protection/CSP and an
  appropriate Content-Security-Policy.
- HSTS belongs at the TLS edge.

## 10. Runtime/container limits

Backend baseline:

- memory <= 768 MiB
- CPU <= 1.5 cores
- pids <= 256

CMS baseline:

- memory <= 2 GiB
- CPU <= 2 cores
- pids <= 256

Containers must run as a non-root user.

A container should be allowed to fail closed under pathological input rather
than consume all host resources.

## 11. Reverse proxy

- rate limiting enabled
- request/body timeout enabled
- client header timeout enabled
- keepalive bounded
- default client body <= 2 MiB
- media route-specific body ceiling <= 8 MiB
- upstream connect/read timeout <= 15 seconds
- `server_tokens off`
- request IDs propagated

## 12. Stress-release gate

For a local no-database fast endpoint under 100 concurrent clients:

- error rate < 1%
- p95 <= 500 ms backend
- p95 <= 1,000 ms CMS
- process must remain alive
- RSS must return close to baseline after load

Oversized requests must be rejected before business/database work.

A malformed payload, upload storm, invalid JWT flood, giant manifest, or
unreachable upstream must not crash the process or create an unbounded queue.

## 13. CI gate

A release is blocked by:

- plaintext/reversible password storage
- tracked production secrets
- missing authentication on protected routes
- tenant isolation failure
- unlimited renderer/kernel input
- unlimited uploads
- unlimited upstream wait
- process crash under defined stress envelope
- database or response operations with no explicit safety ceiling
