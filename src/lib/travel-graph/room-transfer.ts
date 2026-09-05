import {
  routeBuildingToBuilding,
  type BuildingRouteEndpoint,
  type BuildingWalkRouteResult,
} from "./building-route";
import type { TravelGraph } from "./engine";

/** Minimal room identity needed for outdoor transfer planning. */
export type RoomTransferEndpoint = {
  id: number;
  code: string;
  buildingId: number | null;
};

export type RoomTransferStatus =
  | "same-room"
  | "same-building-indoor-unknown"
  | "origin-building-unassigned"
  | "destination-building-unassigned"
  | "origin-building-missing"
  | "destination-building-missing"
  | "origin-building-invalid"
  | "destination-building-invalid"
  | "origin-off-network"
  | "destination-off-network"
  | "no-route"
  | "ok";

export type RoomTransferResult = {
  status: RoomTransferStatus;
  originRoomId: number;
  destinationRoomId: number;
  originBuildingId: number | null;
  destinationBuildingId: number | null;
  /** Null when no honest outdoor estimate exists. Same exact room is 0. */
  outdoorMeters: number | null;
  /** Null when no honest outdoor estimate exists. Same exact room is 0. */
  outdoorSeconds: number | null;
  /** Present only after both room endpoints resolve to distinct buildings. */
  buildingRoute: BuildingWalkRouteResult | null;
};

export type RouteRoomTransferInput = {
  graph: TravelGraph;
  originRoom: RoomTransferEndpoint;
  destinationRoom: RoomTransferEndpoint;
  buildings: readonly BuildingRouteEndpoint[];
  maxSnapMeters: number;
};

function buildingIndex(
  buildings: readonly BuildingRouteEndpoint[],
): Map<number, BuildingRouteEndpoint> {
  const byId = new Map<number, BuildingRouteEndpoint>();
  for (const building of buildings) {
    if (byId.has(building.id)) {
      throw new Error(
        `room transfer: duplicate building id ${building.id} in routing source`,
      );
    }
    byId.set(building.id, building);
  }
  return byId;
}

function mapBuildingRouteStatus(
  status: BuildingWalkRouteResult["status"],
): RoomTransferStatus {
  switch (status) {
    case "origin-invalid":
      return "origin-building-invalid";
    case "destination-invalid":
      return "destination-building-invalid";
    case "origin-off-network":
      return "origin-off-network";
    case "destination-off-network":
      return "destination-off-network";
    case "no-route":
      return "no-route";
    case "ok":
      return "ok";
    case "same-building":
      // Distinct room buildingIds are resolved before delegation, so reaching
      // this state means the supplied building source violates identity.
      throw new Error(
        "room transfer: distinct parent building ids resolved to one route identity",
      );
  }
}

/**
 * Resolve the outdoor portion of a room-to-room transfer without pretending
 * Room TBA has indoor topology.
 *
 * Contract:
 * - same exact room => zero transfer;
 * - different rooms in one building => indoor transfer unknown (never zero);
 * - different buildings => delegate to the canonical building walking router;
 * - missing/unassigned/invalid/off-network parents fail closed.
 */
export function routeRoomTransfer({
  graph,
  originRoom,
  destinationRoom,
  buildings,
  maxSnapMeters,
}: RouteRoomTransferInput): RoomTransferResult {
  const base = {
    originRoomId: originRoom.id,
    destinationRoomId: destinationRoom.id,
    originBuildingId: originRoom.buildingId,
    destinationBuildingId: destinationRoom.buildingId,
  };

  if (originRoom.id === destinationRoom.id) {
    return {
      ...base,
      status: "same-room",
      outdoorMeters: 0,
      outdoorSeconds: 0,
      buildingRoute: null,
    };
  }

  if (originRoom.buildingId === null) {
    return {
      ...base,
      status: "origin-building-unassigned",
      outdoorMeters: null,
      outdoorSeconds: null,
      buildingRoute: null,
    };
  }
  if (destinationRoom.buildingId === null) {
    return {
      ...base,
      status: "destination-building-unassigned",
      outdoorMeters: null,
      outdoorSeconds: null,
      buildingRoute: null,
    };
  }

  if (originRoom.buildingId === destinationRoom.buildingId) {
    return {
      ...base,
      status: "same-building-indoor-unknown",
      outdoorMeters: null,
      outdoorSeconds: null,
      buildingRoute: null,
    };
  }

  const byId = buildingIndex(buildings);
  const originBuilding = byId.get(originRoom.buildingId);
  if (!originBuilding) {
    return {
      ...base,
      status: "origin-building-missing",
      outdoorMeters: null,
      outdoorSeconds: null,
      buildingRoute: null,
    };
  }
  const destinationBuilding = byId.get(destinationRoom.buildingId);
  if (!destinationBuilding) {
    return {
      ...base,
      status: "destination-building-missing",
      outdoorMeters: null,
      outdoorSeconds: null,
      buildingRoute: null,
    };
  }

  const buildingRoute = routeBuildingToBuilding({
    graph,
    origin: originBuilding,
    destination: destinationBuilding,
    maxSnapMeters,
  });
  const status = mapBuildingRouteStatus(buildingRoute.status);

  return {
    ...base,
    status,
    outdoorMeters: buildingRoute.route?.totalMeters ?? null,
    outdoorSeconds: buildingRoute.route?.totalSeconds ?? null,
    buildingRoute,
  };
}
