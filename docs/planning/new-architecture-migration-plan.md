# New Architecture Migration Plan — `react-native-cache-video`

> **Status:** Draft for review — no code changed yet.
> **Author:** Migration planning pass
> **Decisions locked (from kickoff):**
> - **Minimum RN version:** `0.76` (first release where the New Architecture is the default).
> - **Arch mode:** **New-Architecture-ONLY** — drop the old bridge / dual-mode entirely.
> - **Native languages:** Android **Java → Kotlin**; iOS **stays Objective-C++ (`.mm`)** (GCDWebServer is Obj-C).
> - **Deliverable now:** this written plan. No implementation until it's approved.

---

## 1. Where the project stands today

`react-native-cache-video` is a **native TurboModule library** scaffolded from the older
`create-react-native-library` *backward-compatible* template, currently pinned to **RN 0.72.17**.

| Area | Current state |
|------|---------------|
| JS spec | `src/NativeCacheVideoHttpProxy.ts` — a `TurboModule` interface (`start`, `stop`, `respond`) |
| Codegen | `codegenConfig` present (`name: RNCacheVideoHttpProxySpec`, `type: modules`, `jsSrcsDir: src`) |
| Android | Java, `src/newarch` + `src/oldarch` split, `TurboReactPackage`, `nanohttpd` server, `BuildConfig.IS_NEW_ARCHITECTURE_ENABLED` gating |
| iOS | `CacheVideoHttpProxy.mm` (Obj-C++), `RCT_NEW_ARCH_ENABLED` `#ifdef`s, GCDWebServer bundled in-tree |
| Events | JS `DeviceEventEmitter` ⇄ Android `RCTDeviceEventEmitter`, iOS `bridge.eventDispatcher sendAppEventWithName:` |
| Example app | RN 0.72.17, `newArchEnabled=false`, Flipper enabled, react-native-video 5.x |
| Build | `bob` (builder-bob 0.23), yarn 3 workspaces, AGP 7.2.1, iOS platform 12.4 |

### 1.1 Latent problems this migration must fix (found while reading the code)

These prove the New Architecture path has **never actually compiled** and are not optional cleanups —
they are blockers the migration resolves:

1. **Android new-arch spec won't compile.** `android/src/newarch/CacheVideoHttpProxySpec.java` declares its
   constructor as `CacheVideoSpec(...)` inside class `CacheVideoHttpProxySpec` — no matching class, dead on arrival.
2. **`respond` type mismatch across the boundary.**
   - JS spec: `respond(requestId: **number**, ...)`
   - iOS impl: `respond:(NSString *)requestId ...`; Android impl: `respond(**String** requestId, ...)`
   - The actual runtime value is a string (`"<millis>:<rand>"`). Under codegen the generated abstract method
     signature (`double requestId`) will not match the implementation → compile failure. **The JS spec is wrong;
     `requestId` must be `string`.**
3. **Legacy `multiply()` example method** still present in Android module, iOS `.mm`, and the old-arch abstract
   spec — not in the JS spec, pure dead code.
4. **Events bypass the spec.** `httpServerResponseReceived` is emitted via the **legacy bridge**
   (`bridge.eventDispatcher` on iOS, `getJSModule(RCTDeviceEventEmitter)` on Android). This is the single largest
   bridgeless-mode risk (see §4).
5. **iOS `start` uses `dispatch_sync(dispatch_get_main_queue(), …)`** — deadlock hazard; TurboModule methods no
   longer run on the JS thread the way the old bridge assumed.

---

## 2. Target end-state

- Library builds and runs **only** under the New Architecture (Fabric/TurboModule, bridgeless), RN **≥ 0.76**.
- **No** `RCT_NEW_ARCH_ENABLED` / `isNewArchitectureEnabled()` branches anywhere.
- Android: single Kotlin module extending the **codegen-generated** `NativeCacheVideoHttpProxySpec`; no
  `src/oldarch`, no `src/newarch` shim, no `TurboReactPackage` conditional info provider.
- iOS: `.mm` conforming to `NativeCacheVideoHttpProxySpec`, no `#ifdef`, events emitted through a bridgeless-safe
  path.
- JS spec corrected (`requestId: string`), `multiply` gone.
- Example app upgraded to RN 0.76 with `newArchEnabled=true`, Flipper removed, running on a real device/sim.
- `bob`, codegen, podspec, gradle all on 0.76-era tooling.

---

## 3. Phased plan

Each phase ends at a **gate** — a point where you review before I continue. Phases are ordered so the library
compiles in isolation (codegen) before the example app is dragged along.

### Phase 0 — Branch, baseline, safety net
- Create branch `feat/new-architecture-migration`.
- Record a known-good baseline: `yarn`, `yarn typecheck`, `yarn lint`, `yarn test`, `yarn prepare` (bob build) all
  green on the current code so regressions are attributable.
- Snapshot the example app running old-arch (so we have a behavioral reference for the video-cache flow).
- **Gate 0:** confirm baseline captured.

### Phase 1 — JS / TypeScript spec correctness (no arch change yet)
- Fix `src/NativeCacheVideoHttpProxy.ts`: `respond(requestId: **string**, code: number, type: string, body: string)`.
- Remove `multiply` everywhere it lingers (it isn't in the spec but exists in native — delete native copies too in
  later phases).
- Decide the **events contract** (see §4) and encode it in the spec now, because it drives native codegen.
- Re-run codegen locally (`bob build` / the RN codegen script) to confirm the generated spec headers match.
- **Gate 1:** spec compiles through codegen; you approve the events approach.

### Phase 2 — Package/build config bump to RN 0.76 tooling
- `package.json`:
  - devDeps: `react-native` → `0.76.x`, `react` → `18.3.1`, `@types/react` → `~18.3`, **remove `@types/react-native`**
    (types ship inside `react-native` since 0.73), `react-native-builder-bob` → `^0.30`, eslint config →
    `@react-native/eslint-config` `0.76.x`, `@types/jest`/`jest`/`babel` as needed.
  - Drop the `@types/react` `17.0.21` `resolutions`/override.
  - `codegenConfig`: keep `type: modules`; add `"android": { "javaPackageName": "com.cachevideo" }` for determinism.
  - Bump `engines.node` if 0.76 requires it (≥ 18 is fine).
- `.nvmrc` / CI node version sanity check.
- **Gate 2:** `yarn install` resolves cleanly; typecheck passes against RN 0.76 types.

### Phase 3 — Android: Java → Kotlin, new-arch-only
- Delete `android/src/oldarch/` and `android/src/newarch/` (the shim). Under new-arch-only the module extends the
  **generated** `NativeCacheVideoHttpProxySpec` directly.
- Rewrite in Kotlin:
  - `CacheVideoHttpProxyModule.kt` → `class CacheVideoHttpProxyModule(context) : NativeCacheVideoHttpProxySpec(context)`,
    `@ReactModule(name = NAME)`, implement `start/stop/respond` (correct `respond(requestId: String, …)`), keep
    `LifecycleEventListener`. Drop `multiply`.
  - `CacheVideoHttpProxyPackage.kt` → `BaseReactPackage` with `getModule` + `getReactModuleInfoProvider` returning
    `isTurboModule = true` unconditionally.
  - `Server.java` → Kotlin (`Server.kt`), and migrate event emission to the bridgeless-safe API
    (`reactContext.emitDeviceEvent(eventName, params)` — available RN 0.72+ and correct under bridgeless) instead of
    `getJSModule(RCTDeviceEventEmitter)`.
- `android/build.gradle`:
  - Always `apply plugin: "com.facebook.react"`; remove every `isNewArchitectureEnabled()` branch and the
    old/new sourceSet switching (keep only the codegen `generated/source/codegen/java` dir).
  - AGP `7.2.1` → **`8.x`** (0.76 baseline), `compileOptions`/kotlin JVM target → **17**, add the Kotlin gradle
    plugin + `kotlinVersion`.
  - `minSdkVersion` → **24** (RN 0.76 floor), align `compileSdk`/`targetSdk` (35).
  - Keep `nanohttpd 2.3.1`; replace `com.facebook.react:react-native:+` with the react gradle plugin's managed dep.
  - Always define the `react { … }` codegen block (no `if`).
- Delete `AndroidManifestNew.xml` special-casing if namespace is now unconditional (AGP 8 always supports namespace).
- **Gate 3:** `./gradlew :react-native-cache-video:assembleDebug` (via example) compiles; codegen emits
  `NativeCacheVideoHttpProxySpec`.

### Phase 4 — iOS: new-arch-only Obj-C++
- `CacheVideoHttpProxy.h`: drop the `#else` old-bridge branch — always
  `@interface CacheVideoHttpProxy : NSObject <NativeCacheVideoHttpProxySpec>`.
- `CacheVideoHttpProxy.mm`:
  - Remove `#ifdef RCT_NEW_ARCH_ENABLED` guards; keep the single `getTurboModule:` returning
    `std::make_shared<facebook::react::NativeCacheVideoHttpProxySpecJSI>(params)`.
  - Replace `self.bridge.eventDispatcher sendAppEventWithName:` (legacy, unsafe under bridgeless) with the chosen
    events mechanism from §4.
  - Remove `multiply`. Fix `respond` to match the corrected `requestId: string` (already `NSString*` — good).
  - Review `dispatch_sync(dispatch_get_main_queue())` in `start` — switch to `dispatch_async` or guard against
    running on main to avoid deadlock.
- `react-native-cache-video.podspec`:
  - Collapse to the modern form: rely on `install_modules_dependencies(s)` unconditionally (RN ≥ 0.71 always present
    at 0.76); delete the entire `else` block with the manual `React-Codegen`/`RCT-Folly`/`ReactCommon` deps and the
    `RCT_NEW_ARCH_ENABLED` `compiler_flags` branch.
  - Bump `s.platforms` → `:ios => "15.1"` (RN 0.76 floor).
- **Gate 4:** `pod install` (new arch) + `xcodebuild` of the example scheme succeeds.

### Phase 5 — Example app upgrade to RN 0.76 (own phase — this is the biggest app-side lift)
- Upgrade `example/` from 0.72.17 → 0.76.x using the **RN Upgrade Helper** diff as the reference (Podfile,
  `gradle.properties`, `settings.gradle`, `MainApplication`, `AppDelegate`, metro/babel configs all change shape).
- Set `newArchEnabled=true` (Android) and confirm Fabric/bridgeless on iOS (0.76 default).
- **Remove Flipper** (dropped in 0.74+) from Podfile and gradle.
- Check `react-native-video` — v5.2.1 is EOL and not new-arch compatible; plan to bump to **v6.x** (new-arch
  ready). *This is a dependency of the example only, not the library, but the demo won't run without it.*
- `react-native-blob-util` / `react-native-url-polyfill` peer deps: verify new-arch-compatible versions.
- **Gate 5:** example builds and launches on iOS sim + Android emulator under new arch.

### Phase 6 — Validation & docs
- Manually exercise the real feature paths (not just build): MP4 cache, HLS via provider, byte-range segment
  serving, cache clear — the `httpServerResponseReceived` event round-trip is the critical integration point to
  verify end-to-end under bridgeless.
- `yarn typecheck`, `yarn lint`, `yarn test`, `yarn prepare` green.
- Update `README.md` (min RN 0.76, new-arch requirement), bump library `version` (minor/major — this is a breaking
  support change), note the dropped old-arch support in a changelog entry.
- **Gate 6:** sign-off; open PR.

---

## 4. Key design decision — the event channel (`httpServerResponseReceived`)

This is the one genuinely architectural choice and the biggest bridgeless risk, so it's called out separately.

The module pushes server requests to JS via `DeviceEventEmitter` events; the TurboModule spec does **not** declare
them. Options, in order of preference:

- **A. Keep `DeviceEventEmitter`, fix only the native emit call (lowest risk, recommended).**
  JS stays on `DeviceEventEmitter.addListener('httpServerResponseReceived', …)`. Native switches to bridgeless-safe
  emission: Android `reactContext.emitDeviceEvent(name, params)`; iOS emit device events without touching
  `RCTBridge.eventDispatcher` (use the module's callable-JS-modules path / `RCTDeviceEventEmitter` via the current
  `RCTModuleRegistry`). Smallest diff, no JS-consumer breakage.
- **B. Codegen-typed EventEmitter (cleanest, more churn).** Declare the event in the spec
  (`EventEmitter<Payload>`), regenerate, emit through the generated emitter. Type-safe but requires reshaping the
  payload into a codegen-expressible struct and touching every consumer in `src/Libs/httpProxy.ts`.

**Recommendation: A** for this migration (keeps the public JS API stable), with B noted as a follow-up. I'll confirm
with you at **Gate 1** before wiring it, since it affects the spec.

---

## 5. Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| R1 | iOS event emission breaks under bridgeless (`bridge.eventDispatcher` gone) | High | §4 option A; verify event round-trip in Phase 6 before sign-off |
| R2 | Example app 0.72→0.76 upgrade is large & fiddly (Podfile/Flipper/gradle) | High | Isolated Phase 5; use Upgrade Helper diff; example is not shipped, so it can lag if needed |
| R3 | `react-native-video` 5.x incompatible with new arch | High | Bump to v6 in example (Phase 5); library itself doesn't depend on it |
| R4 | Kotlin conversion introduces behavior drift in `Server` (byte-range logic) | Medium | Port method-for-method, keep nanohttpd; validate byte-range in Phase 6 |
| R5 | Consumers on old arch can no longer use the lib (breaking) | Certain (by design) | Major/minor version bump + README + changelog note |
| R6 | `dispatch_sync` deadlock surfaces on new-arch threading | Medium | Rework in Phase 4 |
| R7 | Codegen name/package mismatches (`RNCacheVideoHttpProxySpec` vs module name `CacheVideoHttpProxy`) | Medium | Pin `codegenConfig.android.javaPackageName`; verify generated headers in Gate 1/3 |

---

## 6. File-by-file change map (quick reference)

| File | Action |
|------|--------|
| `src/NativeCacheVideoHttpProxy.ts` | Fix `respond` → `requestId: string`; (opt. B) declare events |
| `src/Libs/httpProxy.ts` | Unchanged under option A; touched under option B |
| `package.json` | Bump RN/react/types/bob/eslint; drop `@types/react-native`; codegen android pkg |
| `android/build.gradle` | Remove arch branches; AGP 8, Kotlin, JDK 17, minSdk 24, unconditional react{} |
| `android/src/oldarch/**`, `android/src/newarch/**` | **Delete** |
| `android/src/main/java/com/cachevideo/*.java` | **Rewrite as Kotlin**, extend generated spec, drop `multiply` |
| `android/.../httpServer/Server.java` | → `Server.kt`; `emitDeviceEvent` |
| `android/src/main/AndroidManifestNew.xml` | Fold into single manifest (AGP 8 namespace) |
| `ios/CacheVideoHttpProxy.h` | Remove `#else` old-bridge branch |
| `ios/CacheVideoHttpProxy.mm` | Remove `#ifdef`s & `multiply`; fix events; fix `dispatch_sync` |
| `react-native-cache-video.podspec` | Collapse to unconditional new-arch form; iOS 15.1 |
| `example/**` | Full RN 0.76 upgrade (Phase 5) |
| `README.md` / changelog | Document min RN 0.76 + new-arch-only |

---

## 7. Open questions before implementation (will confirm at the noted gates)

1. **Events:** approve option **A** (keep `DeviceEventEmitter`, stable JS API)? — *Gate 1*
2. **Versioning:** release this as a **major** bump (breaking: drops old-arch support) or minor? — *Phase 6*
3. **Example `react-native-video`:** OK to move the example to **v6**? (example-only) — *Phase 5*
4. **CI:** is there a CI config (`.github/workflows`) that also needs the RN/AGP/JDK bumps? — I'll check in Phase 2.

---

*Next step after your approval of this plan: execute Phase 0 (branch + baseline).*
