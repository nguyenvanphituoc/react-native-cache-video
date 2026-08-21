---
schema_version: 1
archetype: library
entry_point: src/index.tsx
---

# Project Profile — android-streamed-downloads

`react-native-cache-video` is a React Native library (TurboModule-backed HLS/MP4 caching proxy),
not an app or service. This pitch is a native-transport fix at a single existing seam
(`SimpleSessionProvider.dataTask`, `src/Libs/session.ts`) — it changes no public JS export
surface, so the reachability seam for its use cases is that seam plus the two existing callers
that already route through it (`CacheFileRepository.writeTemp`, `PreCacheProvider.prepareSourceMedia`),
both reachable from the package's own public entry point, `src/index.tsx`.

Consumers: `example/` (bare RN) and `example-expo/` (Expo dev-client + prebuild) both exercise
this path indirectly via `usePrefetch`/playback — neither app changes for this pitch.
