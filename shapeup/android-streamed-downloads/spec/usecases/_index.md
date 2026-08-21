---
type: usecase-index
feature: android-streamed-downloads
tags: []
---

# Use Case Index: Android streamed-to-disk downloads

| ID | Title | Actor | Status | Depends On |
|---|---|---|---|---|
| [[UC-StreamAndroidDownload]] | Stream an Android download directly to disk with bounded memory | System | ready | — |
| [[UC-CancelAndroidDownload]] | Cancel an in-flight Android native download | System | ready | UC-StreamAndroidDownload (cancels a call it started) |
| [[UC-MaintainIOSSpecConformance]] | Keep the iOS build/link green after the shared Spec gains two required methods | System | ready | — |

## Dependency Diagram

```
UC-StreamAndroidDownload ──(a running call can be cancelled by)──► UC-CancelAndroidDownload

UC-MaintainIOSSpecConformance (independent — build-time only, shares the Spec.ts source file
                                that UC-StreamAndroidDownload/UC-CancelAndroidDownload also
                                depend on, but has no runtime call relationship to either)
```
