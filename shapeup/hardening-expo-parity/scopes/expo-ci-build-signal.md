---
scope_id: expo-ci-build-signal
topology_type: CHOWDER
use_cases: [UC-ExpoCIBuildSignal]
depends_on: [expo-videolist-parity]
allowed_file_substrate:
  - .github/workflows/ci.yml
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "bash -c 'grep -q \"build-android-expo\" .github/workflows/ci.yml && grep -q \"example-expo\" .github/workflows/ci.yml'"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One flow: a new `build-android-expo` CI job mirroring the existing `build-android` job's steps
(prebuild → Gradle assemble) but scoped to the Expo example app, triggered on PRs touching
`src/**` or the Expo app's own tree, with its own distinct Gradle/turbo cache key. Single file
(`.github/workflows/ci.yml`), no other scope touches it — the existing bare-RN `build-android`
job is read-only reference here, never edited. There is no second directory to cross, so this is
the declared CHOWDER exception rather than a forced two-layer label. `depends_on:
[expo-videolist-parity]` mirrors the spec's own use-case edge in `spec/usecases/_index.md` ("CI
validates the demo, so it lands second within W1") — the job it adds builds the very Expo example
app `expo-videolist-parity` populates, so it must land after.

The fixture is a static shape-check on the workflow file (job name + path trigger present) — it
cannot itself run a GitHub Actions job locally; the use case's own acceptance criteria call for a
test PR (or a documented dry run) as the actual trigger verification, which is an EVAL/QA-time
check against the live repo, not a local T0 command.
