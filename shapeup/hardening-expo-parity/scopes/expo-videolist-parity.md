---
scope_id: expo-videolist-parity
topology_type: LAYER_CAKE
use_cases: [UC-ExpoVideoListParity]
depends_on: []
allowed_file_substrate:
  - example-expo/src/components/VideoList.tsx
  - example-expo/src/components/VideoItem.tsx
  - example-expo/src/data/streams.ts
  - example-expo/App.tsx
shared_substrate: []
affordance_manifest:
  - test_id: ExpoVideoListPrefetch.VideoList
    role: swap-in list component (mirrors the bare-RN example's VideoList exactly; not default-mounted)
    required_states: [idle, warming, warmed, evicted]
e2e_verification_fixtures:
  - "yarn workspace react-native-cache-video-example-expo typecheck"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One flow: mirror the bare-RN example app's `VideoList`/`VideoItem`/`streams.ts` byte-for-byte
into the Expo example app's `src/` (only creating what's missing), then wire the Expo app's
`App.tsx` to make `VideoList` reachable as a swappable component — `SingleVideo` stays the
default mount, per the pitch's resolved open question OQ5. UI screen (`App.tsx`) and its
component tree (`VideoList`/`VideoItem`/`streams.ts`) are one balanced flow inside one app
package — LAYER_CAKE. The bare-RN example's own files are explicitly out of substrate and are
never written here, only read as the mirror source.

The affordance manifest's state names (`idle`/`warming`/`warmed`/`evicted`) are taken verbatim
from `spec/ux-behavior.md`'s own `ExpoVideoListPrefetch` state table rather than the generic
five-state set — this is a library archetype (per `project-profile.md`), and the UX spec already
declares this screen's actual states identical to the bare-RN `VideoList`'s.
