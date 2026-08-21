---
scope_id: js-wrapper-android-branch
topology_type: CHOWDER
use_cases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload]
depends_on: [android-native-transport, jest-native-mock-extension]
allowed_file_substrate:
  - src/Libs/session.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn typecheck"
  - "yarn test"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One file, the single existing seam both use cases attach at: `SimpleSessionProvider.dataTask`'s
Android branch (A3) in `src/Libs/session.ts` is amended to generate a `requestId`, call the
native `downloadToFile`/`cancelDownload` TurboModule methods instead of
`RNFetchBlob.config(...).fetch(...)`, and wrap the result into a `StatefulPromise<FetchBlobResponse>`
shaped identically to what `blob-util`'s `fileCache` mode already returns (RULE-02) — including
`.cancel()` routing to native `cancelDownload(requestId)` for UC-CancelAndroidDownload. Both use
cases share this one wrapper and one file; splitting stream-wiring from cancel-wiring would race
two writers on the same `.cancel()` implementation, so one scope owns both.

`depends_on: [android-native-transport, jest-native-mock-extension]` — this scope needs both the
real native methods to exist (so the TurboModule call resolves against real signatures once a
device is attached) and the mock's knobs to exist (so its own regression fixture can exercise the
branch under jest today) before it can land.

`session.ts` is the seam `writeTemp`/`prepareSourceMedia`/`cancelTask`/`cancelAllTask` and the
prefetch window's eviction logic all already call, transitively from `src/index.tsx` — dozens of
existing tests exercise it indirectly. `yarn test` (full suite) is this scope's own fixture rather
than a single new test file because the acceptance bar here is explicitly regression: iOS and
non-`{fileCache,path}` Android calls must stay completely untouched. New scripted coverage of the
Android branch itself is `test-surface-coverage`'s job, one wave later.
