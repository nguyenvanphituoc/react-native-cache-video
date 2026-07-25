# Contract Registry — hls-caching-features

| Repository | Contract | Source Type | Service / Engine | Status | SPIKE Task |
|-----------|----------|------------|-----------------|--------|------------|
| `AssetRegistryRepository` | [[asset-registry.contract]] | offline-storage | Persisted JSON (`ProxyCacheManager` `localFileUrl`) + in-memory `MemoryCacheProvider<CacheEntry>` | ✅ confirmed | — (resolved at Orient, `spike-registry-v2-eviction.md`) |
| `CacheFileRepository` | [[cache-file-store.contract]] | offline-storage | Device filesystem via `react-native-blob-util` (`FileBucket.cache`) | ✅ confirmed | — |
| `ProxyRequestGateway` | [[proxy-request-gateway.contract]] | be-service | Local loopback HTTP proxy (`BridgeServer`, `src/Libs/httpProxy.ts`) | ✅ confirmed | — |

No third-party-api contracts — the CDN origin is reached through the existing, already-proven
`SimpleSessionProvider`/`RNFetchBlob` session layer (unchanged by this pitch); the pitch's Fit
Check found no blocking spikes (`shaping.md#Unknowns-Spike-Needed`). The one residual unknown
(`react-native-blob-util` cancel fidelity on-device) is explicitly not jest-verifiable and is
deferred to the post-PASS QA edge hunt, not a SPIKE task on this board.
