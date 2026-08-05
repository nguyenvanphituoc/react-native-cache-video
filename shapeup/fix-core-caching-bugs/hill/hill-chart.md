# Hill Chart — fix-core-caching-bugs (round 1, post-BUILD)

Derived mechanically (DD-10) from T0 artifacts `t0/verdicts/r1-a1.<scope>.json` — all green,
no regressions; T1 (spec-evaluator) pending ⇒ every scope sits at DOWNHILL_EXECUTION.

| scope | phase (r1) | T0 | evidence |
|---|---|---|---|
| regression-net | DOWNHILL_EXECUTION | 🟢 r1-a1 | 17 tests from zero; sha 0334…2814 |
| verified-cache-pipeline | DOWNHILL_EXECUTION | 🟢 r1-a1 (re-verify after D6 contract fix) | 21 tests; sha 9ff7…53f3 |
| server-start-truth | DOWNHILL_EXECUTION | 🟢 r1-a1 | 17 tests + codegen check; sha 1d02…36ae |
| readiness-observation | DOWNHILL_EXECUTION | 🟢 r1-a1 | 17 tests; sha a039…9880 |
| reasoned-fallback | DOWNHILL_EXECUTION | 🟢 r1-a1 | 17 tests; sha 02e5…eff0 |

```
UPHILL ────────── CREST ────────── DOWNHILL ────────── FINISHED
                                   ● regression-net
                                   ● verified-cache-pipeline
                                   ● server-start-truth
                                   ● readiness-observation
                                   ● reasoned-fallback
```

FINISHED requires: T1 PASS + seesaw green + merged to main.
