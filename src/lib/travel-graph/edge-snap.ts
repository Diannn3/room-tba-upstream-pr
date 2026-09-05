import { distanceMeters } from "../campus-route";
import { edgeCoordinates, type TravelGraph } from "./engine";

export type EdgeSnapCoordinate = [lng: number, lat: number];

export type SegmentProjection = {
  coordinate: EdgeSnapCoordinate;
  segmentFraction: number;
  distanceMeters: number;
};

export type GraphEdgeSnap = {
  edgeIndex: number;
  segmentIndex: number;
  segmentFraction: number;
  snappedCoordinate: EdgeSnapCoordinate;
  snapMeters: number;
  uNodeIndex: number;
  vNodeIndex: number;
  oneway: boolean;
  edgeMetersFromU: number;
  edgeMetersToV: number;
  geometryMetersFromU: number;
  geometryMetersToV: number;
  fractionAlongEdge: number;
};

type EdgeGeometryIndexEntry = {
  coordinates: EdgeSnapCoordinate[];
  cumulativeMeters: number[];
  geometryMeters: number;
};

const METERS_PER_DEGREE = 111_320;
const SNAP_EPSILON_METERS = 1e-7;
const edgeGeometryIndexCache = new WeakMap<
  TravelGraph,
  EdgeGeometryIndexEntry[]
>();

function sameCoordinate(
  a: EdgeSnapCoordinate,
  b: EdgeSnapCoordinate,
): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;
}

function appendCoordinate(
  coordinates: EdgeSnapCoordinate[],
  coordinate: EdgeSnapCoordinate,
): void {
  const previous = coordinates.at(-1);
  if (!previous || !sameCoordinate(previous, coordinate)) {
    coordinates.push(coordinate);
  }
}

/**
 * Project one geographic point onto a short line segment using the same local
 * tangent-plane approximation as the rest of Room TBA's campus distance math.
 */
export function projectPointToSegmentMeters(
  point: { lat: number; lon: number },
  a: EdgeSnapCoordinate,
  b: EdgeSnapCoordinate,
): SegmentProjection {
  const meanLat = ((point.lat + a[1] + b[1]) / 3) * (Math.PI / 180);
  const metersPerDegreeLon = Math.cos(meanLat) * METERS_PER_DEGREE;
  const ax = (a[0] - point.lon) * metersPerDegreeLon;
  const ay = (a[1] - point.lat) * METERS_PER_DEGREE;
  const bx = (b[0] - point.lon) * metersPerDegreeLon;
  const by = (b[1] - point.lat) * METERS_PER_DEGREE;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  let segmentFraction = 0;
  if (lengthSquared > 0) {
    segmentFraction = Math.min(
      1,
      Math.max(0, -(ax * dx + ay * dy) / lengthSquared),
    );
  }

  const coordinate: EdgeSnapCoordinate = [
    a[0] + (b[0] - a[0]) * segmentFraction,
    a[1] + (b[1] - a[1]) * segmentFraction,
  ];

  return {
    coordinate,
    segmentFraction,
    distanceMeters: distanceMeters(point, {
      lon: coordinate[0],
      lat: coordinate[1],
    }),
  };
}

function edgeGeometryIndex(graph: TravelGraph): EdgeGeometryIndexEntry[] {
  const cached = edgeGeometryIndexCache.get(graph);
  if (cached) return cached;

  const entries = graph.edges.map((_, edgeIndex) => {
    const coordinates = edgeCoordinates(graph, edgeIndex);
    const cumulativeMeters = new Array<number>(coordinates.length).fill(0);
    let geometryMeters = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const previous = coordinates[i - 1];
      const current = coordinates[i];
      if (!previous || !current) continue;
      geometryMeters += distanceMeters(
        { lon: previous[0], lat: previous[1] },
        { lon: current[0], lat: current[1] },
      );
      cumulativeMeters[i] = geometryMeters;
    }
    return { coordinates, cumulativeMeters, geometryMeters };
  });

  edgeGeometryIndexCache.set(graph, entries);
  return entries;
}

/** Find the geometrically closest point on any walk-graph edge. */
export function nearestEdgeSnap(
  graph: TravelGraph,
  point: { lat: number; lon: number },
): GraphEdgeSnap {
  if (graph.edges.length === 0) {
    throw new Error("building route: travel graph has no edges");
  }

  const indexed = edgeGeometryIndex(graph);
  let best:
    | {
        edgeIndex: number;
        segmentIndex: number;
        projection: SegmentProjection;
        geometryMetersFromU: number;
      }
    | undefined;

  for (let edgeIndex = 0; edgeIndex < graph.edges.length; edgeIndex++) {
    const entry = indexed[edgeIndex];
    if (!entry || entry.coordinates.length < 2) continue;

    for (
      let segmentIndex = 0;
      segmentIndex < entry.coordinates.length - 1;
      segmentIndex++
    ) {
      const a = entry.coordinates[segmentIndex];
      const b = entry.coordinates[segmentIndex + 1];
      if (!a || !b) continue;
      const projection = projectPointToSegmentMeters(point, a, b);
      if (
        best &&
        projection.distanceMeters >= best.projection.distanceMeters - SNAP_EPSILON_METERS
      ) {
        continue;
      }

      const segmentMeters = distanceMeters(
        { lon: a[0], lat: a[1] },
        { lon: b[0], lat: b[1] },
      );
      best = {
        edgeIndex,
        segmentIndex,
        projection,
        geometryMetersFromU:
          (entry.cumulativeMeters[segmentIndex] ?? 0) +
          segmentMeters * projection.segmentFraction,
      };
    }
  }

  if (!best) {
    throw new Error("building route: walk graph has no usable edge geometry");
  }

  const edge = graph.edges[best.edgeIndex];
  const entry = indexed[best.edgeIndex];
  if (!edge || !entry) {
    throw new Error("building route: snapped edge is missing");
  }

  const [uNodeIndex, vNodeIndex, graphMeters] = edge;
  const fractionAlongEdge =
    entry.geometryMeters > 0
      ? Math.min(1, Math.max(0, best.geometryMetersFromU / entry.geometryMeters))
      : 0;
  const edgeMetersFromU = graphMeters * fractionAlongEdge;
  const edgeMetersToV = Math.max(0, graphMeters - edgeMetersFromU);

  return {
    edgeIndex: best.edgeIndex,
    segmentIndex: best.segmentIndex,
    segmentFraction: best.projection.segmentFraction,
    snappedCoordinate: best.projection.coordinate,
    snapMeters: best.projection.distanceMeters,
    uNodeIndex,
    vNodeIndex,
    oneway: Boolean(edge[6]),
    edgeMetersFromU,
    edgeMetersToV,
    geometryMetersFromU: best.geometryMetersFromU,
    geometryMetersToV: Math.max(0, entry.geometryMeters - best.geometryMetersFromU),
    fractionAlongEdge,
  };
}

function coordinatesFromUToSnap(
  graph: TravelGraph,
  snap: GraphEdgeSnap,
): EdgeSnapCoordinate[] {
  const entry = edgeGeometryIndex(graph)[snap.edgeIndex];
  if (!entry) throw new Error("building route: snapped edge geometry is missing");
  const result: EdgeSnapCoordinate[] = [];
  for (let i = 0; i <= snap.segmentIndex; i++) {
    const coordinate = entry.coordinates[i];
    if (coordinate) appendCoordinate(result, coordinate);
  }
  appendCoordinate(result, snap.snappedCoordinate);
  return result;
}

function coordinatesFromSnapToV(
  graph: TravelGraph,
  snap: GraphEdgeSnap,
): EdgeSnapCoordinate[] {
  const entry = edgeGeometryIndex(graph)[snap.edgeIndex];
  if (!entry) throw new Error("building route: snapped edge geometry is missing");
  const result: EdgeSnapCoordinate[] = [snap.snappedCoordinate];
  for (let i = snap.segmentIndex + 1; i < entry.coordinates.length; i++) {
    const coordinate = entry.coordinates[i];
    if (coordinate) appendCoordinate(result, coordinate);
  }
  return result;
}

export function edgeGeometrySnapToNode(
  graph: TravelGraph,
  snap: GraphEdgeSnap,
  nodeIndex: number,
): EdgeSnapCoordinate[] {
  if (nodeIndex === snap.uNodeIndex) {
    return [...coordinatesFromUToSnap(graph, snap)].reverse();
  }
  if (nodeIndex === snap.vNodeIndex) {
    return coordinatesFromSnapToV(graph, snap);
  }
  throw new Error("building route: node is not an endpoint of snapped edge");
}

export function edgeGeometryNodeToSnap(
  graph: TravelGraph,
  snap: GraphEdgeSnap,
  nodeIndex: number,
): EdgeSnapCoordinate[] {
  if (nodeIndex === snap.uNodeIndex) {
    return coordinatesFromUToSnap(graph, snap);
  }
  if (nodeIndex === snap.vNodeIndex) {
    return [...coordinatesFromSnapToV(graph, snap)].reverse();
  }
  throw new Error("building route: node is not an endpoint of snapped edge");
}

/** Geometry between two virtual points on the same stored edge. */
export function edgeGeometryBetweenSnaps(
  graph: TravelGraph,
  from: GraphEdgeSnap,
  to: GraphEdgeSnap,
): EdgeSnapCoordinate[] {
  if (from.edgeIndex !== to.edgeIndex) {
    throw new Error("building route: edge snaps belong to different edges");
  }

  if (Math.abs(from.geometryMetersFromU - to.geometryMetersFromU) <= SNAP_EPSILON_METERS) {
    return [from.snappedCoordinate];
  }

  if (from.geometryMetersFromU > to.geometryMetersFromU) {
    return [...edgeGeometryBetweenSnaps(graph, to, from)].reverse();
  }

  const entry = edgeGeometryIndex(graph)[from.edgeIndex];
  if (!entry) throw new Error("building route: snapped edge geometry is missing");
  const result: EdgeSnapCoordinate[] = [from.snappedCoordinate];

  for (let vertexIndex = from.segmentIndex + 1; vertexIndex <= to.segmentIndex; vertexIndex++) {
    const vertex = entry.coordinates[vertexIndex];
    if (vertex) appendCoordinate(result, vertex);
  }
  appendCoordinate(result, to.snappedCoordinate);
  return result;
}
