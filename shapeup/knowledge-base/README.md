# Knowledge Base — team-shared harness guidelines

`/coach` distills PO/TL feedback from the Ship Gate (L4) into durable guidelines and files
each one under the **one skill that acts on it**, in this directory. These files are
**committed on purpose** — a teammate inherits the harness's accumulated judgment on `git pull`.

| File | Read by | At |
|------|---------|----|
| `task-executor.md`     | `task-executor`     | Phase 1 (Context Load) |
| `ba-pitch-analyzer.md` | `ba-pitch-analyzer` | Phase 1 (Ingest & Scan) |
| `qa-edge-hunter.md`    | `qa-edge-hunter`    | Phase Q1 (Charter Map) |

These are **guidelines, not invariants** — they steer a worker's approach; they never override a
spec or change the `spec-evaluator` verdict (single-judge rule). `spec-evaluator` is deliberately
not coachable.

`_INBOX.md`, if present, holds rules migrated from a pre-0.12 flat knowledge base that have not yet
been categorized. Run `/coach` on its contents to sort each rule into the right skill file, then
delete `_INBOX.md`.
