import { ENDPOINT_SNAP_TOLERANCE_METERS } from "@constants/travel-modes";
import type { BuildingRouteEndpoint } from "@lib/travel-graph/building-route";
import type { TravelGraph } from "@lib/travel-graph/engine";
import { loadTravelGraph } from "@lib/travel-graph/load";
import {
  evaluateClassTransfers,
  type ClassTransferEvaluation,
} from "./class-transfer";
import {
  resolveTransferRoomsForStops,
  type RoomTransferSourceIssue,
  type RoomTransferSourceResolution,
} from "./room-transfer-source";
import type { ScheduleDayStop } from "./types";

export type ClassTransferPlanResult =
  | {
      status: "ready";
      evaluations: ClassTransferEvaluation[];
      roomSourceIssues: Map<number, RoomTransferSourceIssue>;
    }
  | {
      status: "graph-unavailable";
      evaluations: [];
      roomSourceIssues: Map<number, RoomTransferSourceIssue>;
    };

export type PlanClassTransfersInput = {
  stops: readonly ScheduleDayStop[];
  buildings: readonly BuildingRouteEndpoint[];
  bufferSeconds?: number;
};

export type ClassTransferPlanDependencies = {
  loadGraph: () => Promise<TravelGraph>;
  resolveRooms: (
    stops: readonly ScheduleDayStop[],
  ) => Promise<RoomTransferSourceResolution>;
};

const defaultDependencies: ClassTransferPlanDependencies = {
  loadGraph: loadTravelGraph,
  resolveRooms: resolveTransferRoomsForStops,
};

/**
 * End-to-end planner for adjacent class transfers.
 *
 * This is intentionally a thin orchestrator. It reuses the same walk-graph
 * loader and ENDPOINT_SNAP_TOLERANCE_METERS policy as the building router,
 * resolves room identities cache-first, and delegates all transfer math to
 * the pure evaluator. A missing graph fails closed instead of falling back to
 * straight-line or OSRM estimates.
 */
export async function planClassTransfers(
  { stops, buildings, bufferSeconds }: PlanClassTransfersInput,
  dependencies: ClassTransferPlanDependencies = defaultDependencies,
): Promise<ClassTransferPlanResult> {
  const roomResolution = await dependencies.resolveRooms(stops);

  let graph: TravelGraph;
  try {
    graph = await dependencies.loadGraph();
  } catch {
    return {
      status: "graph-unavailable",
      evaluations: [],
      roomSourceIssues: roomResolution.issuesByRoomId,
    };
  }

  return {
    status: "ready",
    evaluations: evaluateClassTransfers({
      stops,
      roomsById: roomResolution.roomsById,
      buildings,
      graph,
      maxSnapMeters: ENDPOINT_SNAP_TOLERANCE_METERS,
      ...(bufferSeconds === undefined ? {} : { bufferSeconds }),
    }),
    roomSourceIssues: roomResolution.issuesByRoomId,
  };
}
