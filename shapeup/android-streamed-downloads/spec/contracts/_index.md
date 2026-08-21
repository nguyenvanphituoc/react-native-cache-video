# Contract Registry — android-streamed-downloads

| Repository | Source Type | Service / Engine | Status | Spike |
|-----------|------------|-----------------|--------|-------|
| [[android-download-transport.contract]] | offline-storage (native-bridge RPC, device-local; no external vendor) | `CacheVideoHttpProxy` Android TurboModule (OkHttp/Okio) | ✅ confirmed | — (rank-2 compile-visibility risk retired — `spike-okhttp-visibility.md`) |

Both methods below are native-bridge calls, not HTTP calls to a remote service — `be-service`
and `third-party-api` do not fit (no network hop to code this repo doesn't own; OkHttp is a
transitively-available compile-time dependency, confirmed by the orient spike, not a vendor
API this pitch integrates against). `offline-storage` is the closest existing source type
(device-local operation, schema is defined in this spec, contract is verifiable from the
codebase today) — the "storage schema" below is the native-bridge method's own request/response
shape rather than a DB table, since that is what a developer actually needs to implement A1/A2.

The Spike column carries a STATUS, not a task id. The registry is committed; the board is not,
and its ids renumber on every regeneration — so a task id recorded here resolves on the machine
that wrote it and nowhere else (spec-lint TIER-DIRECTION).
