---
type: usecase-index
feature: hls-caching-features
tags: [round-4]
---

# Use Case Index: HLS Caching — Round-4 Completion

| ID | Title | Actor | Status | Depends On |
|---|---|---|---|---|
| [[UC-RangedSegmentCacheWrite]] | Ranged Segment Cache Write (BUG-9) | System | ready | — |
| [[UC-OriginErrorRejection]] | Origin Error Rejection (BUG-11) | System | ready | — |
| [[UC-SingleProxyListenerLifecycle]] | Single Proxy Listener Lifecycle (BUG-7) | System | ready | — |
| [[UC-SafeErrorBodyBridging]] | Safe Error Body Bridging (BUG-8, JS-only) | System | ready | — |
| [[UC-PrefetchSegmentRegistration]] | Prefetch Segment Registration (BUG-10) | System | ready | — |
| [[UC-GracefulTestTeardown]] | Graceful Test Teardown (BUG-14, minor) | System | ready | — |
| [[UC-SlidingWindowSegmentDelivery]] | Sliding Window Segment Delivery — device diagnosis (BUG-12, uphill) | System | ready | — |
| [[UC-CleanModuleBoundary]] | Clean Module Boundary (BUG-13, minor) | System | ready | — |
| [[UC-FullLifecycleRegression]] | Full Lifecycle Regression | System | ready | UC-RangedSegmentCacheWrite, UC-OriginErrorRejection, UC-SingleProxyListenerLifecycle, UC-SafeErrorBodyBridging, UC-PrefetchSegmentRegistration |

## Dependency Diagram

```
UC-RangedSegmentCacheWrite      ─┐
UC-OriginErrorRejection         ─┤
UC-SingleProxyListenerLifecycle ─┼──► UC-FullLifecycleRegression
UC-SafeErrorBodyBridging        ─┤
UC-PrefetchSegmentRegistration  ─┘

UC-GracefulTestTeardown            (independent — sliding-window-prefetch hygiene)
UC-SlidingWindowSegmentDelivery    (independent — device-only diagnosis, uphill)
UC-CleanModuleBoundary             (independent — cache-key-identity, minor)
```

## Scope Mapping (per completion plan Phase A)

| UC | Owning Scope | Round-4 Group |
|---|---|---|
| UC-RangedSegmentCacheWrite | pin-generation-guard (primitive) → hls-registry-and-ingestion (wiring) | A1 → A2 |
| UC-OriginErrorRejection | pin-generation-guard (primitive) → hls-registry-and-ingestion (wiring) | A1 → A2 |
| UC-SingleProxyListenerLifecycle | hls-registry-and-ingestion | A2 |
| UC-SafeErrorBodyBridging | hls-registry-and-ingestion | A2 |
| UC-PrefetchSegmentRegistration | sliding-window-prefetch | A3 |
| UC-GracefulTestTeardown | sliding-window-prefetch | A3 |
| UC-SlidingWindowSegmentDelivery | sliding-window-prefetch | A3 (parallel device diagnosis) |
| UC-CleanModuleBoundary | cache-key-identity | A4 |
| UC-FullLifecycleRegression | full-lifecycle-integration | A5 |
