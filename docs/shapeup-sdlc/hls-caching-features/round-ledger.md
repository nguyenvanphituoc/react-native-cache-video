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
