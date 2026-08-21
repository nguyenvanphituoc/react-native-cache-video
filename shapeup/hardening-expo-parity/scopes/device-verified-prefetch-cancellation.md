---
scope_id: device-verified-prefetch-cancellation
topology_type: CHOWDER
use_cases: [UC-DeviceVerifiedPrefetchCancellation]
depends_on: []
allowed_file_substrate:
  - docs/device-verification-runbook.md
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "bash -c 'test -f docs/device-verification-runbook.md && grep -q \"iOS\" docs/device-verification-runbook.md && grep -q \"Android\" docs/device-verification-runbook.md && grep -qi \"pass\\|fail\" docs/device-verification-runbook.md'"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

This use case's entire deliverable is one artifact: a repeatable runbook targeting the existing,
unmodified bare-RN example app's `VideoListPrefetch` screen, executed once on a physical iOS
device and once on a physical Android device, with pass/fail recorded in the document itself.
There is no source-code call chain to slice — the "flow" is the runbook's own numbered steps plus
its results section — and no other scope touches `docs/`, so this is the declared CHOWDER
exception (a true single-file stray) rather than a forced two-layer label.

The fixture is mechanical, not a device stand-in: it asserts the runbook exists and its results
section actually records both platforms with a pass/fail outcome, which is the one thing T0 can
check without physical hardware. It cannot verify the runbook's steps were followed correctly —
that judgment belongs to EVAL, reading the recorded results — only that the deliverable's
required shape is present. Automated verification of "the native transfer actually stopped" is
out of this scope's reach by design.
