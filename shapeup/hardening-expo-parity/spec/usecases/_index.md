---
type: usecase-index
feature: hardening-expo-parity
tags: [w0, w1]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Cases: 0.5.1 Hardening + Expo Parity

## W0 — Hardening (`src/`)

| Use Case | Actor | Requirement(s) | Part | Risk |
|---|---|---|---|---|
| [[UC-CacheKeyPolicyConfiguration]] | Consumer App Developer | R0 | A1, A2 | Downhill |
| [[UC-CacheStatusEventExport]] | Consumer App Developer | R1 | A1 | Downhill |
| [[UC-RangedCacheHitContentRange]] | System | R2, R3 | A3 | Highest — corrected shape (see spike) |
| [[UC-DeviceVerifiedPrefetchCancellation]] | Developer (manual runbook) | R4, R5 | A4 | Downhill (deliverable shape unambiguous) |

## W1 — Bare/Expo Demo Parity (`example-expo/` + `.github/workflows/`)

| Use Case | Actor | Requirement(s) | Part | Risk |
|---|---|---|---|---|
| [[UC-ExpoVideoListParity]] | Expo Developer | R6 | A5 | Downhill-leaning |
| [[UC-ExpoCIBuildSignal]] | PR Author | R7 | A6 | Downhill-leaning |

All six use cases are additive — no existing use case is modified, no existing call site loses
behavior. W0 and W1 touch disjoint parts of the tree and carry no `depends_on` edge between them
except [[UC-ExpoCIBuildSignal]] → [[UC-ExpoVideoListParity]] (CI validates the demo, so it lands
second within W1).
