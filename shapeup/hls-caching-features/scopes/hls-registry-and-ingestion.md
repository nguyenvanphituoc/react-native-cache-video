---
type: scope-contract
scope_id: hls-registry-and-ingestion
feature: hls-caching-features
topology_type: ICEBERG
tasks: [TASK-003, TASK-004, TASK-005]
allowed_file_substrate:
  - src/Libs/httpProxy.ts
  - src/ProxyCacheManager.ts
  - src/__tests__/http-proxy.test.ts
  - src/__tests__/registry-eviction.test.ts
  - src/__tests__/hls-ingest.test.ts
  - src/__tests__/hls-ingest-prefetch-forwarder.test.ts
shared_substrate: []
e2e_verification_fixtures:
  - "yarn test src/__tests__/registry-eviction.test.ts src/__tests__/hls-ingest.test.ts src/__tests__/hls-ingest-prefetch-forwarder.test.ts src/__tests__/http-proxy.test.ts"
  - "yarn typecheck"
hill_phase: "UPHILL_UNKNOWN"
---

# Scope: hls-registry-and-ingestion

## Why this slice

One vertical call chain: the native bridge listener lifecycle
(`BridgeServer.listen` / `HttpProxy.start`, BUG-7), the single response
choke-point (`Response.send`, BUG-8 JS-only half), and the segment proxy
handler that wires both new primitives from `pin-generation-guard` into a
real HTTP response (`addSegmentHandler`, BUG-9/BUG-11 wiring) — all in
`src/Libs/httpProxy.ts` and `src/ProxyCacheManager.ts`, the two files a
request actually flows through end to end. ICEBERG: the complexity sits
entirely on the proxy/registry side (native bridge race conditions, base64
encoding, origin status/Content-Range threading) — there is no thin UI
counterpart, the "screen" is the example app's player issuing HTTP requests
against this handler.

`src/__tests__/http-proxy.test.ts` is a NEW file (TASK-004 creates it,
TASK-005 extends it additively) — the existing scope-summary already flags
it as an unbuilt fixture glob. No other scope in this round writes to
`httpProxy.ts`, `ProxyCacheManager.ts`, or this new test file, so the
substrate is fully owned, not shared.

Riskiest-first within this scope: TASK-004 (listener race guard) before
TASK-005 (base64 encoding shares TASK-004's new fixture file, additive) before
TASK-003 (wiring, depends on `pin-generation-guard`'s TASK-001/TASK-002
landing first per the board's cross-scope dependency) — the two independent
tracks (TASK-004→005 vs TASK-003) can build in either order relative to each
other, but TASK-003 cannot start before `pin-generation-guard` is green.

## Affordances

| test_id | role | required_states |
|---|---|---|
| addSegmentHandler-range-status-passthrough | proxy-handler | [idle, loading, success, error] |
| bridgeserver-listen-single-subscription | lifecycle-guard | [idle, loading, success, error, empty] |
| response-send-base64-all-branches | response-encoder | [success, error, empty] |
