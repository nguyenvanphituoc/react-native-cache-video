---
scope_id: writetemp-workaround-removal
topology_type: CHOWDER
use_cases: [UC-StreamAndroidDownload]
depends_on: [js-wrapper-android-branch]
allowed_file_substrate:
  - src/Libs/verifiedWrite.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "bash -c '! grep -in \"android\" src/Libs/verifiedWrite.ts'"
  - "yarn typecheck"
  - "yarn test"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One file, one deletion: `CacheFileRepository.writeTemp`'s Android-only in-memory-base64 branch
(the original BUG-17 mitigation, `src/Libs/verifiedWrite.ts` lines 189-204) is removed so Android
runs the exact same single code path iOS already runs (INV-05, A4). No other scope touches this
file — a true single-file stray with no second layer to cross, CHOWDER. `depends_on:
[js-wrapper-android-branch]` because deleting the workaround is only safe once the thing it
worked around (in-memory buffering) is actually replaced by the new streaming path one layer
down — removing it first would reintroduce the original OOM
defect with no safety net.

The first fixture is mechanical and literal: after this scope lands, no line in
`verifiedWrite.ts` should still reference "Android" as a branch condition — the regression check
TS-INV-05 itself specifies (grep lines 189-204 absent). `yarn typecheck` and the full `yarn test`
regression net confirm the merged single path still typechecks and that no existing
`writeTemp` consumer (`verified-cache-writes.test.ts`, `pin-cancel-verified-write.test.ts`, and
every other caller) breaks.
