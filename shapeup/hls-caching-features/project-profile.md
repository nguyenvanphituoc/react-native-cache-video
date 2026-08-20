---
schema_version: 1
archetype: library
entry_point: src/index.tsx
note: "React Native library (react-native-cache-video). The public surface is src/index.tsx (package.json `source: src/index`); every engine must be reachable from it, either as an export or through the CacheManager/ProxyCacheManager composition root it constructs. The two example apps (example/, example-expo/) are consumers of that surface, not entry points — an engine reachable only from an example is orphaned."
---

# Project Profile — hls-caching-features

## Archetype

`library` — an npm-published React Native module with a native iOS (`ios/`) and Android
(`android/`) half plus a TypeScript core (`src/`). It is not `mobile`: nothing here is an app that
ships to a store; the deliverable is `lib/` built by `bob build` and published to npm.

## Entry point

`src/index.tsx` — the barrel that `package.json`'s `source`/`main`/`module` all resolve to.
Reachability for every use case is traced against it. Two seams sit behind it and count as
entry-point call sites for wiring purposes because `src/index.tsx` constructs or re-exports them:

| Seam | File | What reaches the consumer through it |
|---|---|---|
| `CacheManager` / `ProxyCacheManager` | `src/ProxyCacheManager.ts` | the singleton the app configures and the proxy every request flows through |
| `PreCacheProvider` + hooks | `src/Provider/`, `src/Hooks/` | React-facing affordances (`usePrefetch`, provider config) |

## Run commands

| Purpose | Command |
|---|---|
| Unit tests (T0 fixture surface) | `yarn test` |
| Types | `yarn typecheck` |
| Lint | `yarn lint` |
| Build the publishable artifact | `yarn prepare` (`bob build` + `build:plugin`) |
| Bare example on device | `yarn example ios` / `yarn example android` |
| Expo example on device | `yarn workspace react-native-cache-video-example-expo ios` |

## Consequence for this run

There is no running app to probe from the harness itself. Every phase that would "probe the
running app" (EVAL's observable outcomes, QA's edge hunt) grades against the jest fixture surface
plus static reachability from `src/index.tsx`; anything that can only be observed on a device is a
`manual_checks` item on the scope contract and is signed off by the PO at GATE L4, never
self-reported green by a worker.
