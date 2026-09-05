# Building-to-building walking router

Room TBA's building router is a walking-only Map tools task. It selects exactly
two mapped buildings and estimates the outdoor walk between their map pins.

## Routing contract

- Route authority: `src/generated/walk-graph.json` through the existing
  client-side travel-graph engine.
- Walking speed: the shared `WALK_KPH` constant. The building router does not
  own a second speed.
- Endpoint correlation: each building pin snaps to the geometrically nearest
  point on mapped walk-edge geometry, not merely to the nearest junction node.
  The snapped edge must belong to the graph's largest weakly connected
  component and the pin-to-edge distance must remain within the audited hard
  ceiling.
- Virtual endpoint routing: an edge snap behaves as a lightweight query node.
  Partial edge distance from the snap to each legal endpoint is combined with
  the existing target-bounded Dijkstra result. The checked-in `TravelGraph`
  itself is never mutated.
- One-way semantics remain authoritative. A virtual origin on a one-way edge
  may continue only in the stored direction; a virtual destination may only be
  approached from a legal direction. Two snaps on the same edge use the direct
  sub-edge path only when directionality permits it.
- Canonical totals include both approximate building-pin connectors:
  - origin pin → origin edge snap
  - mapped graph route, including partial origin/destination edges
  - destination edge snap → destination pin
- The solid maroon map line is authoritative graph geometry. Dashed gray
  connector lines are approximate and are never presented as surveyed
  entrances or indoor paths. Microscopic connectors under 1.5 m remain in
  distance/time totals but are omitted visually to avoid sub-pixel dash noise.
- Unsupported endpoints and directed `no-route` results fail closed. There is
  no Haversine, OSRM, or other fallback ETA.
- Selecting the same building twice is an explicit non-route state. There is no
  outdoor walking route to estimate.

## Connector rendering

Approximate building-pin connectors render below the authoritative route at a
lighter 2 px / 56% opacity dash. The graph route uses the existing Room TBA
route language: an 8 px neutral casing beneath the 5 px maroon line. This keeps
access approximations visually subordinate while preserving route legibility
across roads, labels, and building fills.

## Audit and calibration

The original endpoint audit established the hard snap ceiling against junction
nodes. Edge correlation can only shorten the geometric pin-to-network
connector, so the ceiling is intentionally unchanged. Use the comparison audit
to quantify the improvement and detect any eligibility change:

```sh
bun scripts/building-edge-snap-audit.ts
bun scripts/building-edge-snap-audit.ts --json
```

The real-campus baseline also asserts that every edge snap is no farther from a
building pin than the legacy nearest-node snap, that known off-campus teaching
sites still fail closed, and that New Math → Physical Sciences joins connector
and mapped geometry without a gap.

## Product boundaries

This feature does **not** route individual rooms, infer indoor corridors or
entrances, use live GPS, add waypoints, suggest jeepneys, or alter
Planner/Today/day-route behavior. Generic GPS/transit Directions and the
building router are mutually exclusive task modes.

## Offline behavior

The route core has no routing API dependency. Once the generated walk-graph
chunk is available in the browser, subsequent calculations are local. A cached
session can recalculate or swap a pair while offline. A first-time graph-cache
miss is surfaced as an unavailable/error state rather than replaced by an
approximation.

## QA

Feature-focused checks:

```sh
bun test src/lib/travel-graph/edge-snap.test.ts \
  src/lib/travel-graph/building-route.test.ts \
  src/lib/travel-graph/building-route-map.test.ts \
  src/lib/travel-graph/building-route.baseline.test.ts
bunx vitest run \
  src/components/svelte/building-route/BuildingRoutePanel.component.test.ts \
  src/components/svelte/building-route/BuildingRouteMapOverlay.component.test.ts \
  src/components/svelte/controls/EntityDirectionsChip.component.test.ts \
  src/lib/focus-trap.component.test.ts
bunx playwright test -c playwright.advisory.config.ts \
  e2e/advisory/building-route.spec.ts
```

Before merging, also run `bun run lint`, `bun run test`,
`bun run test:components`, and `bun run build`, plus the relevant advisory E2E.
Validate 320 px, 768 px, and desktop layouts. Visual QA should include New Math
→ Physical Sciences, a same-edge pair, a cross-campus pair, and a known
off-network endpoint.

Physical campus timing/path checks remain the final evidence for calibration.
Do not change `WALK_KPH` or endpoint ceilings merely to make an estimate look
closer to one anecdotal walk.
