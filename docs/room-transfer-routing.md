# Room-to-room class transfer estimates

This feature is a **stacked follow-up** to the building-to-building walking
router in upstream PR #1125. It must not be reviewed or merged as an independent
replacement for that foundation. The outdoor route authority remains the
building router and its vendored campus walking graph.

## Dependency and scope

Room transfer planning is intentionally layered:

1. institutional class match → `roomId`
2. room identity → parent `buildingId`
3. parent building pin → canonical building walking router
4. adjacent-class schedule gap → transfer assessment

There is **no indoor graph**. Room TBA's room placement/floor metadata is not a
walkable indoor topology and must not be converted into one by assumption.

This means "room-to-room" in this version is an honest class-transfer estimate,
not surveyed door-to-door navigation.

## Non-negotiable semantics

`src/lib/travel-graph/room-transfer.ts` owns the room boundary contract:

- **Same exact room:** zero outdoor transfer distance/time. No walking transfer
  is needed.
- **Different rooms, same building:** `same-building-indoor-unknown`. Distance
  and time stay `null`. Never display this as `0 min`.
- **Different buildings:** delegate to `routeBuildingToBuilding()` with the
  resolved parent buildings.
- **Room without a parent building:** fail closed.
- **Missing parent building record:** fail closed.
- **Invalid/off-network building pin:** preserve the building router diagnostic;
  do not manufacture an ETA.
- **No mapped route:** fail closed. No Haversine, OSRM, or straight-line
  whole-route fallback is permitted.

The room layer does not own a walking speed. Cross-building distance/time comes
from the canonical building router, which uses Room TBA's shared `WALK_KPH`.

## Endpoint policy

`src/lib/schedule-import/class-transfer-plan.ts` imports the same
`ENDPOINT_SNAP_TOLERANCE_METERS` constant and `loadTravelGraph()` loader used by
`BuildingRouteStore`.

Do not introduce:

- a second room-transfer snap ceiling;
- a second walking-speed constant;
- a second walk-graph artifact;
- an API route fallback when the vendored graph cannot load.

A graph-cache miss is `graph-unavailable`; the UI states plainly that no
fallback estimate was used.

## Room identity authority

Planner sections intentionally persist natural class keys and room-code
snapshots, not database row ids. During a transfer check:

1. `scheduleRouteStore.importFromPlanner()` rematches the saved sections against
   the active institutional class data.
2. `matchImportedScheduleRows()` preserves `ClassMapValue.roomId`.
3. `orderDayTransferStops()` retains **all** chronological scheduled classes,
   including unresolved venues. This differs deliberately from `orderDayStops()`,
   which skips unresolved rows for map waypoint routing.
4. `resolveTransferRoomsForStops()` deduplicates room ids and resolves each room
   cache-first through `getLocalRoomById()`.
5. If local PGlite has no room row, the resolver may fall back to the existing
   public `/api/rooms?code=...` endpoint.
6. The remotely returned `room.id` must equal the institutional `roomId` being
   resolved. An id mismatch fails closed instead of routing the wrong room.

Conflicting room codes attached to one room id also fail closed rather than
choosing a code arbitrarily.

A room with `buildingId: null` is still a valid resolved room identity; the
subsequent room-transfer contract reports the parent building as unassigned.

## Why unresolved classes stay in transfer order

The existing map day-route code only needs classes with coordinates, so
`orderDayStops()` correctly omits unresolved rooms.

Transfer adjacency is different. Consider:

```text
08:00 A 101
09:00 Room TBA
10:00 B 201
```

Dropping the middle class would incorrectly evaluate `A 101 → B 201` as an
adjacent transfer. `orderDayTransferStops()` therefore keeps the Room TBA class,
and the two affected legs are reported as unknown.

## Adjacent-class assessment

Only consecutive chronological classes are evaluated.

For a current class ending at `current.endMinutes` and the next starting at
`next.startMinutes`:

```text
gapSeconds = (next.startMinutes - current.endMinutes) * 60
rawSlackSeconds = gapSeconds - estimatedTransferSeconds
bufferedSlackSeconds = rawSlackSeconds - bufferSeconds
```

The default planning buffer is **300 seconds (5 minutes)**.

Classification:

- `comfortable`: `bufferedSlackSeconds >= 0`
- `tight`: `rawSlackSeconds >= 0` but `bufferedSlackSeconds < 0`
- `likely-insufficient`: `rawSlackSeconds < 0`
- `unknown`: no honest transfer ETA exists

Negative gaps are preserved. Two overlapping classes may therefore be
`likely-insufficient` even when they use the exact same room and require zero
walking time.

The buffer is a schedule-planning margin, not part of route duration and not a
new routing-speed policy.

## Product copy contract

`src/lib/schedule-import/class-transfer-copy.ts` centralizes presentation copy.

Required language:

- Same room: `Same room` / `No walking transfer needed.`
- Different rooms in one building: `Indoor transfer not estimated`.
- Unsupported/unresolved: `Transfer time unavailable`.
- Tight cross-building transfer: say `Tight` and describe the estimate as an
  outdoor walk.
- Insufficient slack: say `Likely not enough time`.

Do **not** say:

- `impossible`;
- `0 min` for different rooms in the same building;
- that an approximate pin connector is a surveyed entrance;
- that the estimate includes corridors, stairs, elevators, or room-to-door
  indoor walking.

The Today screen disclosure is explicit: outdoor estimates use mapped campus
walkways; indoor routes are not modeled.

## Today integration

The Today screen keeps two separate concepts:

- **Route my day:** existing map/day route behavior and existing route totals.
- **Check transfers:** the canonical room/building walking-graph estimator in
  this feature.

Do not silently substitute one result for the other.

Transfer checks are opt-in. Opening Today alone does not trigger institutional
matching, room lookups, or graph loading. When the user chooses **Check
transfers**, the current planner is rematched and the current app-context
building dataset is passed into the transfer planner.

Displayed results are guarded by a signature of the active term and saved plan.
If the plan changes while a check is running, that result is not displayed as
current evidence.

## Current UI states

- fewer than two classes today → transfer check disabled;
- graph unavailable → explicit no-fallback message;
- unexpected planner error → unavailable message, no stale estimate;
- zero adjacent transfer pairs → explicit empty result;
- known pair → per-pair assessment card;
- same-building different-room pair → indoor-unknown card;
- unresolved/off-network pair → unavailable card.

## Verification

Pure room/schedule semantics:

```sh
bun run test:room-transfer
```

This currently includes:

- room transfer boundary semantics;
- class matching room-id retention;
- map-stop vs transfer-stop ordering;
- adjacent transfer formulas and classifications;
- cache-first room resolution and identity guards;
- canonical planner orchestration;
- copy/wording regression tests.

Svelte store and Today UI coverage runs through the repository component suite:

```sh
bun run test:components
```

Before making the stacked feature reviewable, run the full inherited gates too:

```sh
bun run test:routing
bun run test:room-transfer
bun run lint
bun run test:all
bun run build
bun run test:integration:live   # maintainer E2E DB / preview environment
bun run e2e                     # blocking Playwright suite
```

Manual Today QA should cover at minimum:

1. same exact room;
2. different rooms in the same building;
3. normal cross-building pair;
4. tight cross-building pair;
5. likely-insufficient pair;
6. Room TBA/unmatched room;
7. off-network parent building;
8. overlapping classes;
9. graph unavailable / first-cache miss;
10. plan edited while a check is in flight;
11. 320 px, 768 px, and desktop layouts;
12. keyboard focus and screen-reader status output.

## Stacking / merge order

The current implementation branch is based directly on the frozen building
router head from PR #1125. Until #1125 is accepted:

- keep room-transfer work on a separate branch;
- do not add these commits to PR #1125;
- do not present this branch as independently mergeable against upstream
  `staging`;
- rebase the room-transfer branch onto the eventual merged building-router
  commit before opening its upstream PR.

If #1125 changes during review, first reconcile its routing contract, graph
loader, endpoint policy, and building result types. Do not mechanically rebase
and assume the room layer remains valid.
