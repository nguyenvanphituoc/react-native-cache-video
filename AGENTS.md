<!-- HARNESS_START -->
# Shape Up SDLC Local Harness

## Enforcement model

A three-phase Shape Up loop orchestrated by `/tech-lead`. Invariants live in the runtime, not this file — expect hook denials, not arguments.

Skills and commands are named short throughout this file; every one of them resolves only under the plugin's namespace — `Skill(shapeup-sdlc-plugin:orient)`, `/shapeup-sdlc-plugin:ship`. A bare name is not a typo you get a warning for: an unknown skill name is rejected upstream of the hook layer, so the dispatch fires no hook, leaves no decision row, and is answered by improvisation.

- Hook-denied: dispatching a worker without a schema-valid WorkOrder, writing outside the scope's substrate, stopping a run with no receipt (the run's first act writes one).
- Attested, not assumed: a dispatch leaves a receipt naming the skill that ran, and ingest refuses an orchestrated result that has none. A dispatch that fails is answered by the sub-agent improvising the craft, which every other check accepts — so "the artifact exists" is not evidence that the shipped skill produced it. `--no-receipt-check` is the way through when the receipt channel itself fails.
- GATE L2 is advisory — warns when EVAL runs over unfinished tasks, permits the call (per-machine board, operator asked; ADR-0001) — a signal, not a bug.
- Sign-off is a file: each gate resolves from the answer set (`ci`/`guarded`/`interactive`) — cross, stop for the PO, or abort; the decision's source is ledgered.
- **Your scope cut decides your concurrency, not the dial.** Two scopes that both declare a write to one path never build at the same time: `shared` substrate is the sanctioned escape from disjointness, and an edit is read-modify-write, so concurrent writers silently drop each other's work. An entry point listed as writable by five scopes therefore builds five scopes one at a time whatever `--parallel-scopes` says. The run states the ceiling its contracts actually permit before dispatching anything, as a BUILD-order line — a peak below that ceiling is a dispatch problem, a ceiling below the dial is a scope-cut problem, and only the second is fixable by re-cutting. The fix is a cut where exactly one scope owns each entry point. Note the ceiling is narrated, not gated: it does not travel in the ⏸ L1b block, so an unattended run carries it only in its log.
- The build+eval loop breaks only three ways ✦: EVAL PASS → QA → Ship; outer `round_budget` exhausted; opt-in `wall_clock_budget_s` tripped (the wall-clock axis event counters miss). Budget trips route to GATE H — ship what's green, never kill the run from outside. A scope exhausting its per-scope `attempt_budget` (T0 attempts) queues a GATE H proposal, never blocks the round.

### Phase 1 — Shaping (`/shapeup`)
1. Set Boundaries → `/shapeup shaping`
2. Find the Elements → `/shapeup breadboarding`
3. Risks & Rabbit Holes → `/shapeup spike`
(The completed pitch is formed by `shaping.md` + `breadboard.md`)

### Phase 2 — Betting (PO governance, no skill)
Betting Table: PO decides; rejected pitches loop back to raw idea.

### Phase 3 — Building
| Step | Gate | Action |
|------|------|--------|
| Kick-off | ⏸ **L0** — Intake & Config (L0.8 model/budget matrix) + worker roster ✧ | `/translator` if non-English |
| Orient (Scout) | ⏸ **L1a** — Orient Review | `/orient` |
| Analyze | — (reviewed at L1b) | `/ba-pitch-analyzer` (`analyze`): spec tree + board (UC + Invariants + Test Surface ★); before Wire (needs its use cases) |
| Wire | ⏸ **L1a.5** — Wiring Review ✚ | `/solution-architect` (`wire`): sole writer of committed `wiring-map.md` — per-UC engine → seam → entry-point call site → affordance, per `project-profile.md` |
| Map Scopes | ⏸ **L1b** — Board Review (+ substrate disjointness lint) | `/scope-architect` (scope contracts ✦ — sole writer); traceability oracle advisory ✚ |
| Build Vertically | ⏸ **L2** — Board 100% ✅ + T0-green ✦ | per dispatch: compile order → `/task-executor` (--order) → ingest result; T0-verified per attempt (fixtures + DB probe + seesaw ✦), substrate-sandboxed ✦. Scopes build **concurrently** ✦ — `--parallel-scopes N` caps it (default 4), a scope is released the moment its own dependencies are green, and a scope green in this round is skipped rather than rebuilt |
| EVAL (once per round) | ⏸ **L3** — Verdict | `/spec-evaluator` (--order): spec- + test-surface-conformance ★, T0 citation ✦; refuted boxes/verdict applied by ingest |
| FAIL → round r+1 | — | regression rule ★: bugs + full Test Surface of touched UC |

✦ = requires scope contracts (`shapeup/<slug>/scopes/*.md`); ✚ = requires the spine artifacts (`requirements.md`, `wiring-map.md`, `project-profile.md`). Traceability stays advisory until `covers:` is populated. Absent artifact ⇒ arm skipped (non-regression).

✧ **Two refusals, and they answer different questions.** Opening a run refuses outright when the worker skills are not on disk — the roster comes from the schema that defines it, so it cannot drift from a hand-kept list. That alone passes green on the two states that actually happen (installed but disabled, or a different version loaded), so the run's first act is one live canary dispatch, and the evidence is the hook layer's rather than the sub-agent's account of it. A run that cannot reach its workers stops before it spends anything, instead of reporting phases complete while none of the shipped craft was applied.


### QA Edge Hunt (`/qa-edge-hunter`, post-PASS, pre-ship)
**Q0** Preflight → **Q1** Charter (6 lenses − EVAL-covered) → **Hunt** (repro required, findings `~` → ledger) → report (no verdict, no score). Skip with `--no-qa`.

### Ship & Triage
- **SHIP S.0 / GATE H** — `/scope-hammer`: census (QA findings + discovered ledger + attempt-budget proposals ✦) → baseline comparison (never the ideal) → cut list; TL/PO promotes selected items only.
- ⏸ **L4** — Ship Sign-off (shows QA status ★).
- **Coach retro** — L4 feedback → `/coach`; GATE COACH-1 asks the PO which skill owns each rule (never assumes) → committed `shapeup/knowledge-base/<skill>.md` (team inherits on pull). Coachable: `/task-executor`, `/ba-pitch-analyzer`, `/qa-edge-hunter`; `/spec-evaluator` is not (single judge). Mechanism defects file to `knowledge-base/harness-defects.md` as Betting Table raw ideas, never worker steering.
- Post-fix: `eval --single-pass` → remaining `~` + new feedback → new raw idea.

### Discovered Tasks
Everything discovered funnels into `.shapeup/<slug>/discovery/ledger.md` (Orient, task-executor P3.7, QA); a new invariant triggers `ba --tasks-only --from-discovered` → `TS-INV-NN` Test Surface row ★.

### Architectural Invariants
- **Single judge** — verdict belongs to `spec-evaluator`; QA has no verdict, no score.
- **EVAL exactly once per round** — QA sits after PASS, outside the loop.
- **Ledger = single source of truth** — every discovery flow writes only its own section.
- **QA is a level-up, not a gate** — `--no-qa` skips it; circuit breaker outranks the Hunter.
- **Role separation** — Evaluator grades, task-executor fixes, QA discovers.
- **Hill phase is mechanical ✦** — derived only from T0/T1/seesaw artifacts, never self-reported; the evaluator cites a T0 artifact it re-hashes itself.
- **Envelope port (v1.0)** — every dispatch is WorkOrder in / WorkResult out; shared state has exactly one writer (the ingest step); malformed envelopes are hook-denied. Workers: stateless, craft-only, pipeline-blind.

## Setup & Execution

- Orders/results live in `.shapeup/<slug>/orders|results/`; the envelope schemas ship inside the tech-lead skill.
- The plugin's run entry points need a one-time permission grant — `npx shapeup-sdlc init` writes it into `.claude/settings.json` (`permissions.allow`); without it a headless run stalls at step one. That grant is necessary, not sufficient: it covers the run's own deterministic entry points, not the generic file edits every worker skill makes constantly, or any command a worker reaches for beyond the grant's own exact shape. A truly unattended run also needs a Claude Code permission mode that covers those (`acceptEdits` at minimum) — the plugin cannot grant that on your behalf.
- Two storage tiers (ADR-0001): COMMITTED `shapeup/<slug>/` (shaping, spec, scopes, wiring-map, project-profile, requirements, hill, `REPORT.md` frozen at L4) vs GITIGNORED `.shapeup/` (board, orders/results, T0/eval/QA artifacts, ledgers, metrics, gate answers).
- Every run has a `run_id` — the receipt mints it, and orders, T0 artifacts, trial rows, agent-call journal rows and hook decisions all carry it. It is the only key that separates two runs of the same feature: everything else (`order_id`, round/attempt) repeats. It is **not** a time boundary — a relaunch resumes the same run and reuses the key, so one `run_id` legitimately spans every launch after a paused gate or a kill, with hours of wall clock between them, and `orders/<id>.json` is rewritten by each. Anything measuring elapsed time reads the append-only records, never the span of a key. SHIP S.7 exports the run's records as fact tables under `.shapeup/exports/<run_id>/` before the run trace is superseded; a WorkResult carries no `run_id` and reaches it through `order_id`.
- Every run projects a **run graph** — `.shapeup/<slug>/graph.jsonl`, append-only, written only by
  `reduce graph`. Two families kept separate: work lineage (Run, Order, Result, Verdict, Trial,
  GateDecision) and domain (Scope, UseCase, Requirement, Seam). It is derived from the artifacts,
  never authored, so it can be deleted and rebuilt — and a run recorded before it existed backfills
  on first touch. `--subgraph run` is the fast-forward as one bounded query; `--trace <node>` walks
  a verdict back to the objective, the plan, the source, the execution record and the gate that
  crossed it.
- `/hill-chart` (skill `hill-chart`, not a pipeline worker — invoked directly, like `shapeup`) renders both the committed hill shards (`shapeup/<slug>/hill/<scope-id>.yml`, the mechanical phase from the invariant above) and the local run graph as one dashboard: a portfolio card per pitch, and per-pitch a Hill Chart, an attention list, a scope board, round history, and the run graph one click deeper. A pitch whose local run trace was cleaned up after shipping still renders — marked Archived — from its committed hill shards alone.
- Contracts: markdown on disk, JSON on the wire; a single library reads/writes the file form.
- Never hard-code a storage root — generated paths resolve through the shared path resolver.
- The traceability oracle emits `.shapeup/<slug>/trace/report.json` from the spine artifacts.
<!-- HARNESS_END -->
