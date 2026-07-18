---
type: pitch
feature: fix-core-caching-bugs
appetite: "~1 week"
status: ready
lens: lite
bounded_context: video-caching
entities: [ServerState, CacheEntry]
tags: [bugfix, caching, react-native, issue-8, issue-6, issue-5]
skill_version: "4.0"
---

# Pitch Digest: Fix Core Caching Bugs

> Source pitch: `docs/shapeup-sdlc/fix-core-caching-bugs/shaping/shaping.md` (+ breadboard.md).
> Orient artifacts consumed: `.shapeup-sdlc/fix-core-caching-bugs/orient/` (code-surface,
> spike-turbomodule-start-result [RESOLVED], discovered-seed, hill-signal).

## Problem

Apps embedding react-native-cache-video hit three field failures: (a) caching
silently does nothing — every HLS URL falls back to origin with a generic
"invalid url or port" warning (issue #8); (b) integrators cannot tell whether
the caching layer is running — the readiness event never reaches late
subscribers and there is no query API (issue #6); (c) very large mp4s
(400MB–1GB) crash Android playback with an out-of-range read once cached
(issue #5).

## Appetite

**~1 week (≈40h)** — bug-fix cluster with a known code surface. Scope grows →
cut, never extend. Current board: 48h estimated — an 8h HAMMER decision is
pending, see [[scope-summary]].

## Boundaries

### In Scope (Shape A: "Observable lifecycle + verified files")
- A1 server-readiness handshake (native start reports success/failure; bounded retry)
- A2 queryable readiness (ask anytime; late subscribers get current state)
- A3 reasoned fallback (distinct message per cause)
- A4 verified cache writes (temp → verify → atomic promote; unverified discarded)
- A5 regression tests (one repro per issue + harness from zero)

### Non-Go
- Issue #7 (expo-av) — issue comment; expo-av deprecated, v0.4.0 ships Expo support
- Issue #3 (preload URL list) — separate bet, backlog
- New caching features, eviction redesign, CI/platform work beyond these tests
- Streaming rework / HLS session path changes (RH1), native server redesign (RH2)

## Breadboarding

```
[ExampleVideoScreen (P1)]
   │ provider mounts + foreground
   ▼
[JS Cache Layer (P2)] ──start(port)──► [Native Bridge Server (P3)]
   │   ▲ confirmed result (NEW)              │ bind OK / IOException / BOOL
   │   └── serverState S1: idle|starting|ready|failed
   │
   ├─ ready + HLS ──► proxied URL ──► player
   ├─ any fallback ──► reasoned warning (U3) + origin URL ──► player (P5)
   │
   └─ preCacheFor(mp4) ──► [File Cache (P4)]: temp ──verify──► atomic promote ──► S2 registry
                                    └─ fail ──► discard (never served)
```

Affordances U1–U3 / N1–N12 / S1–S2 and slices V1–V5: see the breadboard
(`shaping/breadboard.md`); tasks carry the IDs in their tags.

## Rabbit Holes

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| RH1 large payloads across the JS bridge | high | blob-util direct-to-disk (`path:`) — already the mp4 route |
| RH2 native server rework | med | start-result surface only |
| RH3 port negotiation | low | bounded retry ×3 on fresh random ports |
| RH4 lifecycle churn (StrictMode/foreground) | med | stale-result guard, no state-machine rewrite |

## Document Map

| Document | Type | Status |
|----------|------|--------|
| [[domain-model]] | DDD Model | ✅ ready |
| [[ux-behavior]] | UX Spec (lite: authoritative) | ✅ ready |
| [[usecases/_index]] | Use Cases (5) | ✅ ready |
| [[contracts/native-start.contract]] | Native bridge contract (spike-resolved) | ✅ ready |
| [[scope-summary]] | Scope Summary + HAMMER | ✅ generated |
| [[synthesis]] | Health Dashboard + Traceability + Risk + Dependency | ✅ generated |
| [[feedback]] | Post-Sprint Feedback | ⬜ pending |

(Lite lens: `integration.md` and full `contracts/` folder skipped by design; the
one contract above is the resolved native seam. Task board is LOCAL:
`.shapeup-sdlc/fix-core-caching-bugs/tasks/`.)

---

## Audit Report

*Generated from spec-lint.mjs + board-derive.mjs output — do not edit manually.*

| Check | Result |
|-------|--------|
| spec-lint findings | 0 red · 0 warn (exit 0) |
| Tasks parsed | 15 — all frontmatter complete |
| Edge symmetry (unlocks vs depends_on) | ✅ derived by board-derive `--write` |
| UC anchors | ✅ every FEAT/FIX task resolves to a committed UC |
| Wikilinks | ✅ all resolve within the spec dir |
| Appetite | ⚠️ 48h vs 40h — overflow reported to the caller's HAMMER gate |

### Execution Gate
⚠️ REVIEW — mechanically clean; pending only the appetite HAMMER decision
([[scope-summary#Appetite-HAMMER-reported-not-resolved]]).
