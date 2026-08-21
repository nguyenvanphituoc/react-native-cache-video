---
scope_id: device-verification-runbook
topology_type: CHOWDER
use_cases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload]
depends_on: [writetemp-workaround-removal]
allowed_file_substrate:
  - docs/android-download-device-verification-runbook.md
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "bash -c 'test -f docs/android-download-device-verification-runbook.md && grep -qi \"peak memory\\|flat\" docs/android-download-device-verification-runbook.md && grep -qi \"cancel\" docs/android-download-device-verification-runbook.md && grep -qi \"redirect\\|gzip\" docs/android-download-device-verification-runbook.md && grep -qi \"pass\\|fail\" docs/android-download-device-verification-runbook.md'"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

This use case's entire deliverable is one artifact: the four SPIKE-UNRESOLVED device checks the
shaping pass explicitly deferred (pitch Q3) — large-file completion, flat peak memory (R8),
prompt mid-transfer cancel, and redirect/gzip parity against a real signed CDN URL — recorded
against a real/emulated Android device, with pass/fail evidence attached in the document itself
(this repo's own established G1 precedent for device-only verification). There is no source-code
call chain to slice, only a runbook's own numbered checks plus a results section — the declared
CHOWDER exception, matching this repo's existing `device-verified-prefetch-cancellation` scope
for the same shape of deliverable.

This is a NEW, dedicated file (`docs/android-download-device-verification-runbook.md`), not the
pre-existing `docs/device-verification-runbook.md` — that file already covers a different, earlier
use case (`UC-DeviceVerifiedPrefetchCancellation`, a different feature's prefetch/eviction runbook)
and this scope's substrate must not collide with content another feature's history already owns.
`depends_on: [writetemp-workaround-removal]` because the four checks only mean anything once the
workaround is gone and the new path is the only path Android runs.

The fixture is mechanical, not a device stand-in: it asserts the runbook exists and its content
actually names all four checks (peak memory, cancel, redirect/gzip, plus a recorded pass/fail),
which is the one thing T0 can verify without physical hardware. It cannot verify the checks were
performed correctly on real hardware — that judgment belongs to EVAL, reading the recorded
results.
