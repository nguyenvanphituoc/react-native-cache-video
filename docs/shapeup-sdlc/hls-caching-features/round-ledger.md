# round-ledger — hls-caching-features

Committed subset of run truth (survives a `.shapeup-sdlc/` wipe). Sole writer: tech lead.
Full run trace: `.shapeup-sdlc/hls-caching-features/harness-run.md` (LOCAL, gitignored).

## Model & budget matrix (GATE L0.8/L0.9, resolved 2026-07-25)

| key | value | source |
|---|---|---|
| orch | fable-5 (session; env requested opus — running session supersedes, no degrade) | session |
| exec | sonnet | settings.local.json env (Tier C) |
| eval | sonnet | settings.local.json env (Tier C) |
| qa | haiku | settings.local.json env (Tier C) |
| digester | script | settings.local.json env (Tier C) |
| round_budget (outer) | 5 | env SHAPEUP_ROUND_BUDGET |
| attempt_budget (inner, per scope) | 7 | env SHAPEUP_ATTEMPT_BUDGET |

Run mode: --unattended (PO, at GATE L1a confirm). Appetite: ~6 weeks.

## Build sequence (locked at GATE L1b, 2026-07-25)

1. shared-cache-types (CHOWDER — blocks all)
2. cache-key-identity (V1)
3. hls-registry-and-ingestion (V2/V3)
4. pin-generation-guard (V4)
5. sliding-window-prefetch (V5 — highest residual unknown: isBusy signal)
6. prefetch-hook-wiring (V6)
7. full-lifecycle-integration (CHOWDER — final seam)

Rationale: riskiest-first is overridden where hard substrate dependencies force order —
shared types block every scope; prefetch consumes pin/cancel primitives. The one
open-unknown scope (sliding-window-prefetch) runs as early as its dependencies allow.
WIRE (7.5) skipped: plugin 1.3.0 envelope schema has no solution-architect/wire op.

## Decisions

| # | date | scope | question | answer | source |
|---|---|---|---|---|---|
| D1 | 2026-07-25 | cache-key-identity | default key normalization | signature-denylist (Expires/Signature/Key-Pair-Id/Policy/X-Amz-*/token) + urlKeyExtractor escape hatch; fail-safe to original URL | PO (pre-shaping) |
| D2 | 2026-07-25 | (run) | scope of the bet | all four features, phased F2→F1→F4→F3 | PO (pre-shaping) |
| D3 | 2026-07-25 | sliding-window-prefetch | isBusy() playback-priority signal | compose from session layer's per-URL in-flight bookkeeping tagged by call-site; documented fallback if awkward at TASK-012 | ba (analyze), non-blocking |
| D4 | 2026-07-25 | hls-registry-and-ingestion | TASK-007/008/009 (r1-a1) structurally depend on TASK-005 (isEvictable/bumpGeneration) and TASK-006 (writeTemp/verifyAndPromote) — pin-generation-guard scope's own tasks, not yet built. Re-dispatch as a follow-up fix once pin-generation-guard lands, or accept the interim direct-to-final-write / no-guard-on-eviction behavior as final? | Re-dispatch TASK-007/008/009 as a fix operation once pin-generation-guard (build-sequence scope 4, the very next scope) lands its own r1 — wire the real writeTemp/verifyAndPromote/isEvictable/bumpGeneration primitives into the seams already marked `BLOCKED (cross-scope dependency...)` in ProxyCacheManager.ts (addPlaylistHandler/addSegmentHandler/didEvictHandler) and MemoryCacheLFUSizePolicy.onEvict. Do NOT expand hls-registry-and-ingestion's substrate now — this scope keeps importing, not co-writing, per the scope-architect's own design. Interim behavior (raw FileSystemManager.write, no pin/generation guard consulted on eviction) ships as documented-BLOCKED for this round, not accepted as permanent. | precedent — scope-architect map-scopes.json assumptions ("a cross-scope task dependency, not a shared file write") + round-ledger build sequence (pin-generation-guard is scope 4, next after hls-registry-and-ingestion); advisor-protocol, unattended, does not count against escalation budget |
| D5 | 2026-07-25 | hls-registry-and-ingestion | substrate-expansion: widen this scope (or a follow-up scope) to include `src/types/type.d.ts` + `src/Libs/httpProxy.ts` so a literal `X-Cache` response header can be threaded through `ResponseInterface.send`/the native respond bridge — or is the implemented `DeviceEventEmitter` (`RNCV_CACHE_STATUS`) diagnostic substitute sufficient? | Declined. Substrate is not widened; no scope-architect remap order dispatched. The `RNCV_CACHE_STATUS` DeviceEventEmitter diagnostic substitute stands as sufficient — `proxy-request-gateway.contract` itself scopes `X-Cache` as test/diagnostics-only, never player-consumed, so the underlying player-visible behavior (200 fresh / 200 cached-fallback with the correct body) is unaffected. | advisor-protocol, unattended, most-conservative (narrowest-scope, no substrate expansion) — flagged as a GATE-H hammer proposal for PO review before ship, per Hard Rule "an unattended conservative resolution is always flagged for GATE H" |
