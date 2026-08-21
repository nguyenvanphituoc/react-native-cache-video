---
schema_version: 1
archetype: library
entry_point: src/index.tsx
---

# Project Profile — hardening-expo-parity

`react-native-cache-video` is a React Native library (TurboModule-backed HLS/MP4 caching proxy),
not an app or service. The reachability seam for every use case in this pitch is the package's
own public export surface, `src/index.tsx` — a use case is "wired in" when it is reachable from
that entry point (a new named export, a behavior change behind an existing exported function, or
a change to `example/` / `example-expo/` as a first-party consumer of that same entry point).

Consumers: `example/` (bare RN) and `example-expo/` (Expo dev-client + prebuild) both import
exclusively from `src/index.tsx` (via the package name in their own `node_modules` symlink /
workspace link) — neither app reaches into `src/` internals directly.
