---
type: usecase
feature: hardening-expo-parity
id: UC-ExpoCIBuildSignal
bounded_context: cache-hardening
actor: PR Author
entities: []
repositories: []
domain_events_emitted: []
tags: [r7, scope-a6, w1, ci]
depends_on: ["[[domain-model]]", "[[ux-behavior]]", "[[usecases/UC-ExpoVideoListParity]]"]
status: ready
---

# Use Case: Expo CI Build Signal

## Summary
A pull request that changes the library or `example-expo/` gets an automatic CI signal — a new
job mirroring `ci.yml`'s existing `build-android` job — on whether `example-expo` still builds
for Android, closing the gap where nothing in CI would catch a regression in the Expo demo.

## Preconditions
- `.github/workflows/ci.yml` already has a `build-android` job for bare `example/` — the pattern
  to mirror (`expo prebuild` target Android → `./gradlew assembleDebug`, same Gradle/turbo cache
  strategy) — confirmed working, not yet independently re-read line-by-line by orient (mechanical
  risk only, to be confirmed at build time so the new job's cache key doesn't collide with the
  bare-RN job's).
- The Expo config plugin `example-expo`'s prebuild depends on already shipped and is documented
  working (0.4.0 cycle) — `example-expo/android`/`ios` (gitignored, regenerable) already exist on
  disk from a prior manual `expo prebuild` run. This UC wires CI around a working mechanism, not
  spiking a new one.
- [[usecases/UC-ExpoVideoListParity]] has landed `example-expo/`'s VideoList demo — the CI job
  built here validates the fuller app, not just the pre-existing single-video case.

## Input

```typescript
// No runtime input — this UC is a CI workflow change.
// Trigger: any PR touching the library (`src/**`) or `example-expo/**`.
```

## Steps

```
1. Confirm ci.yml's existing build-android job's exact cache-key strategy (Gradle/turbo) before
   writing the new job, so the two jobs' caches don't silently share (and corrupt) each other's
   key.
2. Add a new CI job (e.g. build-android-expo) to .github/workflows/ci.yml, triggered on PRs
   touching src/** or example-expo/**, mirroring build-android's steps:
   a. Checkout, install deps (same as build-android).
   b. Run `expo prebuild` (Android target) inside example-expo/.
   c. Run `./gradlew assembleDebug` inside example-expo/android.
   d. Cache Gradle/turbo the same way build-android does, using a distinct cache key so the two
      jobs never collide.
3. Job reports a standard GitHub Actions pass/fail status check on the PR — same UX as
   build-android already provides for example/.
```

## Output

```typescript
interface ExpoCIBuildSignalOutput {
  jobName: string           // e.g. "build-android-expo"
  triggersOn: string[]      // ["src/**", "example-expo/**"]
  status: 'pass' | 'fail'   // per-PR CI check result
}
```

## System Flow

```
[PR: touches src/** or example-expo/**]
  → [GitHub Actions: build-android-expo job triggers]
    → [expo prebuild (Android) inside example-expo/]
      → [./gradlew assembleDebug]
        ← [pass/fail status check posted to the PR]
```

## Invariants
- [INV-01] The new job's cache key is distinct from `build-android`'s — a cache collision would
  silently corrupt either job's build artifacts without failing loudly.
- [INV-02] The job triggers on `example-expo/**` changes even when `src/**` is untouched — a
  regression introduced purely inside `example-expo/` (e.g. UC-ExpoVideoListParity's own files)
  is caught, not just library-side regressions.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | `expo prebuild` or `gradlew assembleDebug` fails | n/a (CI job exit code, not HTTP) | Job reports a failing status check on the PR — no auto-merge-block change beyond what `build-android` already enforces for `example/` |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | process | Inspect the new job's cache-key configuration in `ci.yml` against `build-android`'s | Keys are distinct (e.g. different cache-key prefix/suffix) | D1: INV-01 |
| TS-INV-02 | process | Open a PR that touches only `example-expo/**` (no `src/**` change) | The new job triggers and reports a status check | D1: INV-02 |
| TS-REQ-job-mirrors-steps | process | Diff the new job's steps against `build-android`'s | Same step shape (checkout, install, prebuild, gradlew assembleDebug), Android-only (no iOS step, per OQ4) | D3: Input/mirror shape |

## Integration Points
- → [[integration#expo-example-app]] — validates the demo [[usecases/UC-ExpoVideoListParity]]
  lands
- ← [[usecases/UC-ExpoVideoListParity]] — this UC's CI job is meaningless without that UC's
  files present to build
