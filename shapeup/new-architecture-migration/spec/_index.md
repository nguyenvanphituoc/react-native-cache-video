---
type: pitch
feature: new-architecture-migration
appetite: "TBD (uncapped) — informal ~2 weeks assumed"
status: ready
bounded_context: video-cache-proxy
entities: [HttpProxyServer, CacheRequest, CacheResponse, CacheSession]
tags: [migration, turbomodule, new-architecture, rn076]
---

# New Architecture Migration — spec index

**Pitch:** `docs/planning/new-architecture-migration-plan.md` (locked decisions: RN ≥ 0.76, new-arch-ONLY, Android Kotlin, iOS stays Obj-C++).
**Orient artifacts:** `.shapeup-sdlc/new-architecture-migration/orient/` — all 5 plan claims verified + 18 discovered items folded into tasks.

## Problem
The library's New Architecture path has never compiled (broken Android shim, wrong iOS JSI class); events ride legacy bridge APIs that are silently dead under bridgeless; the toolchain is pinned to RN 0.72-era.

## Boundaries
- IN: library JS spec/types, Android Kotlin rewrite, iOS new-arch-only, example RN 0.76 upgrade, CI/tooling, docs.
- OUT: any behavior change (payloads/UX frozen), option-B typed event emitter (follow-up), npm publish (PO-gated), old-arch support (dropped by design).

## Document Map
| Doc | Purpose |
|-----|---------|
| [[domain-model]] | preserved domain + invariants INV-01..07 |
| [[contracts/_index]] | C-01 TurboModule boundary · C-02 event contract (central docs) |
| [[ux-behavior]] | example app as verification surface |
| [[usecases/_index]] | 4 preserved behaviors w/ Test Surfaces |
| [[integration]] | blast radius + silent-failure watchlist |
| [[tasks/_index]] | 12 tasks · 40h · critical path 001→…→012 |
| [[scope-summary]] | Done-when + Appetite Guard |
| [[synthesis]] | Health 🟢🟢🔴 · Gate ✅ PASS · audit 92.6 |
