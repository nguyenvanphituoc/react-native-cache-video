# Code Review Guidelines

Guidance for automated code review (Claude Code Review) on this repository — a React
Native library (`react-native-cache-video`) shipping TypeScript + iOS (ObjC++) +
Android (Kotlin) with old-arch and new-arch (TurboModule) support.

## Important (report these)

- Breaking changes to the public API (`src/index.tsx` exports, TurboModule spec
  `src/NativeCacheVideoHttpProxy.ts`, event names `RNCV_*` / `HLS_CACHING_RESTART`)
- iOS/Android behavior divergence (the two native servers must stay contract-identical:
  `spec/contracts` semantics — start result, port binding, repeat-start)
- Old-arch/new-arch compatibility regressions (codegen spec changes, `__turboModuleProxy`
  selection, Expo config plugin)
- Cache-integrity bugs: anything that could serve an unverified/partial file, register a
  cache entry before verification, or resurrect orphaned `.part` files
- Server-lifecycle races: readiness state vs actual native server state, event emission
  before confirmed start, retry/port handling
- Memory leaks (native server instances, event listeners, subscribers) and unhandled
  promise rejections
- Security: no cleartext exposure beyond the documented localhost proxy, no path
  traversal via cache keys, no secrets

## Nit (mention briefly, don't block)

- Naming/style not enforced by eslint/prettier
- Refactoring opportunities, test readability
- Comment gaps

## Do not report

- Formatting/lint issues (CI runs eslint + prettier; lefthook enforces locally)
- Generated/compiled output: `lib/`, `plugin/build/`, `android/build/`, codegen artifacts
- Lockfiles, `docs/**`, `*.md` content style
- Pre-existing warnings explicitly tracked in `docs/shapeup-sdlc/*/round-ledger.md` or
  the discovery ledger

## Context worth knowing

- Tests are jest with manual mocks under `src/__mock__/` (no real native modules, no
  React renderer); mock knobs are the intended seams — don't flag them as test smells
- `example/` is RN CLI, `example-expo/` is Expo SDK; only `example/` carries the
  readiness-indicator demo by design (scope decision D3)
