---
type: scope-board
feature: android-streamed-downloads
---

# Scope Board: Android streamed-to-disk downloads

| scope_id | topology | use_cases | depends_on | files | lint |
|---|---|---|---|---|---|
| shared-spec-declaration | CHOWDER | UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance | — | src/NativeCacheVideoHttpProxy.ts | pending |
| android-native-transport | CHOWDER | UC-StreamAndroidDownload, UC-CancelAndroidDownload | shared-spec-declaration | android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt | pending |
| ios-spec-conformance-stub | CHOWDER | UC-MaintainIOSSpecConformance | shared-spec-declaration | ios/CacheVideoHttpProxy.mm | pending |
| jest-native-mock-extension | ICEBERG | UC-StreamAndroidDownload, UC-CancelAndroidDownload | shared-spec-declaration | src/__mock__/native-cache-video-http-proxy.js, src/__tests__/native-cache-video-http-proxy-mock.test.ts | pending |
| js-wrapper-android-branch | CHOWDER | UC-StreamAndroidDownload, UC-CancelAndroidDownload | android-native-transport, jest-native-mock-extension | src/Libs/session.ts | pending |
| writetemp-workaround-removal | CHOWDER | UC-StreamAndroidDownload | js-wrapper-android-branch | src/Libs/verifiedWrite.ts | pending |
| test-surface-coverage | CHOWDER | UC-StreamAndroidDownload, UC-CancelAndroidDownload | writetemp-workaround-removal | src/__tests__/android-streamed-download.test.ts | pending |
| full-suite-regression-integration | CHOWDER | UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance | ios-spec-conformance-stub, writetemp-workaround-removal, test-surface-coverage | src/__tests__/android-streamed-download-integration.test.ts | pending |
| device-verification-runbook | CHOWDER | UC-StreamAndroidDownload, UC-CancelAndroidDownload | writetemp-workaround-removal | docs/android-download-device-verification-runbook.md | pending |

## Build order (Kahn levels of `depends_on`)

- Wave 1 (no dependencies): shared-spec-declaration
- Wave 2: android-native-transport, ios-spec-conformance-stub, jest-native-mock-extension
- Wave 3: js-wrapper-android-branch
- Wave 4: writetemp-workaround-removal
- Wave 5: test-surface-coverage, device-verification-runbook
- Wave 6: full-suite-regression-integration (needs ios-spec-conformance-stub + test-surface-coverage)

Riskiest-first within available waves: `shared-spec-declaration` is the single wave-1 scope and
must dispatch first — every other scope is blocked on it. Within wave 2, `android-native-transport`
is riskiest (RH4/RH5 — hand-rolled streaming correctness, file-handle leak on cancel/error paths;
the pitch's own rank-2 risk) and should dispatch first among the three parallel wave-2 scopes,
ahead of `ios-spec-conformance-stub` (RH1, low-effort but easy to forget) and
`jest-native-mock-extension` (mechanical, template-driven).
