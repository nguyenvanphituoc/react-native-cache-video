---
type: scope-board
feature: hardening-expo-parity
---

# Scope Board: 0.5.1 Hardening + Expo Parity

| scope_id | topology | use_cases | depends_on | files | lint |
|---|---|---|---|---|---|
| cache-key-policy-configuration | ICEBERG | UC-CacheKeyPolicyConfiguration | — | src/Utils/cacheKeyPolicy.ts, src/Utils/index.ts, src/__tests__/cache-key-policy.test.ts | pending |
| cache-status-event-export | CHOWDER | UC-CacheStatusEventExport | — | src/index.tsx | pending |
| ranged-cache-hit-content-range | ICEBERG | UC-RangedCacheHitContentRange | — | src/types/cacheAsset.d.ts, src/ProxyCacheManager.ts, src/__tests__/registry-eviction.test.ts, src/__tests__/hls-ingest.test.ts, src/__tests__/hls-ingest-prefetch-forwarder.test.ts, src/__tests__/http-proxy.test.ts, src/__tests__/verified-cache-writes.test.ts, src/__tests__/full-lifecycle.test.ts, src/__tests__/content-range.test.ts | pending |
| device-verified-prefetch-cancellation | CHOWDER | UC-DeviceVerifiedPrefetchCancellation | — | docs/device-verification-runbook.md | pending |
| expo-videolist-parity | LAYER_CAKE | UC-ExpoVideoListParity | — | example-expo/src/components/VideoList.tsx, example-expo/src/components/VideoItem.tsx, example-expo/src/data/streams.ts, example-expo/App.tsx | pending |
| expo-ci-build-signal | CHOWDER | UC-ExpoCIBuildSignal | expo-videolist-parity | .github/workflows/ci.yml | pending |

## Build order (Kahn levels of `depends_on`)

- Wave 1 (no dependencies): cache-key-policy-configuration, cache-status-event-export,
  ranged-cache-hit-content-range, device-verified-prefetch-cancellation, expo-videolist-parity
- Wave 2: expo-ci-build-signal (needs expo-videolist-parity)

Riskiest-first within available waves: `ranged-cache-hit-content-range` (tagged `highest-risk`
by the pitch's own spike — the corrected side-map shape for HLS segment totals) should dispatch
first among the wave-1 scopes.
