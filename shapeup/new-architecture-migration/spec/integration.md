---
type: integration
feature: new-architecture-migration
affected_services: [react-native-runtime, nanohttpd, GCDWebServer, react-native-video, CI]
domain_events_consumed: []
domain_events_produced: [httpServerResponseReceived]
tags: [integration]
depends_on: ["[[domain-model]]", "[[usecases/_index]]"]
status: ready
---

# Integration Map

## Impact Summary
The migration replaces the JS⇄native transport under every integration point while freezing observable behavior. Blast radius: RN runtime APIs (codegen, TurboModule, events), build toolchains (AGP/Kotlin/pods), example-app dependency set, CI.

## RN Runtime (TurboModule/codegen, bridgeless)
- Data flow: JS spec → codegen → generated Java spec + ObjC protocol; events per C-02.
- Trigger: every method call and event.
- Risk: silent event loss if any legacy emit path survives (iOS `bridge` is nil — no error raised).
- Mitigation: TS-BRIDGELESS probe in UC-ServeCachedRequest; grep-gate AC in tasks (no `eventDispatcher`/`getJSModule` remains).

## nanohttpd (Android, stays 2.3.1)
- Risk: Kotlin port drifts serve()/respond() semantics (R4). Mitigation: method-for-method port, INV-02 test, byte-range probe TS-RANGE.

## GCDWebServer (iOS, in-tree)
- Risk: compile warnings/errors under Xcode 26.4 + iOS 15.1 floor. Mitigation: TASK-007 compile gate; only warning-suppression changes allowed in-tree.

## react-native-video v6 (example only)
- Risk: v6 rewrote player internals; local-proxy URL playback + Range behavior unproven (orient A5 unknown #2). Mitigation: TASK-009 isolates the bump; TS-RANGE/TS-HLS re-run on it.

## CI (.github/workflows/ci.yml)
- Risk: JDK 11 (`ci.yml:82`), old action versions silently fail post-migration. Mitigation: TASK-011.

## Silent failure watchlist
1. iOS event emit under bridgeless (highest — was already silently broken on new arch).
2. Codegen name mismatches compile *some* targets but not others (`libraryName` bug `android/build.gradle:111`).
3. Numeric-width coercion (`double` port → int truncation) — guard in native conversion.
