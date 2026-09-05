import type { BuildingRouteEndpoint } from "@lib/travel-graph/building-route";
import {
  routeRoomTransfer,
  type RoomTransferEndpoint,
  type RoomTransferResult,
} from "@lib/travel-graph/room-transfer";
import type { TravelGraph } from "@lib/travel-graph/engine";
import type { ScheduleDayStop } from "./types";

export type ClassTransferAssessment =
  | "comfortable"
  | "tight"
  | "likely-insufficient"
  | "unknown";

export type ClassTransferUnknownReason =
  | "origin-room-unresolved"
  | "destination-room-unresolved"
  | Exclude<
      RoomTransferResult["status"],
      "same-room" | "ok"
    >;

export type ClassTransferEvaluation = {
  fromStopIndex: number;
  toStopIndex: number;
  originRoomId: number | null;
  destinationRoomId: number | null;
  gapSeconds: number;
  estimatedTransferSeconds: number | null;
  rawSlackSeconds: number | null;
  bufferedSlackSeconds: number | null;
  assessment: ClassTransferAssessment;
  unknownReason: ClassTransferUnknownReason | null;
  roomTransfer: RoomTransferResult | null;
};

export type EvaluateClassTransfersInput = {
  stops: readonly ScheduleDayStop[];
  roomsById: ReadonlyMap<number, RoomTransferEndpoint>;
  buildings: readonly BuildingRouteEndpoint[];
  graph: TravelGraph;
  maxSnapMeters: number;
  /** Extra planning margin after the estimated transfer. Defaults to 5 min. */
  bufferSeconds?: number;
};

function classifySlack(
  gapSeconds: number,
  transferSeconds: number,
  bufferSeconds: number,
): Pick<
  ClassTransferEvaluation,
  "rawSlackSeconds" | "bufferedSlackSeconds" | "assessment"
> {
  const rawSlackSeconds = gapSeconds - transferSeconds;
  const bufferedSlackSeconds = rawSlackSeconds - bufferSeconds;
  const assessment: ClassTransferAssessment =
    bufferedSlackSeconds >= 0
      ? "comfortable"
      : rawSlackSeconds >= 0
        ? "tight"
        : "likely-insufficient";
  return { rawSlackSeconds, bufferedSlackSeconds, assessment };
}

function unknownEvaluation(
  fromStopIndex: number,
  from: ScheduleDayStop,
  to: ScheduleDayStop,
  reason: ClassTransferUnknownReason,
  roomTransfer: RoomTransferResult | null,
): ClassTransferEvaluation {
  return {
    fromStopIndex,
    toStopIndex: fromStopIndex + 1,
    originRoomId: from.roomId,
    destinationRoomId: to.roomId,
    gapSeconds: (to.startMinutes - from.endMinutes) * 60,
    estimatedTransferSeconds: null,
    rawSlackSeconds: null,
    bufferedSlackSeconds: null,
    assessment: "unknown",
    unknownReason: reason,
    roomTransfer,
  };
}

/**
 * Evaluate only adjacent classes in chronological order.
 *
 * The estimate is intentionally outdoor-only for cross-building transfers.
 * Same-building different-room transfers remain unknown because Room TBA has
 * no indoor corridor/entrance topology. Copy should therefore describe these
 * as approximate transfer checks, not guarantees.
 */
export function evaluateClassTransfers({
  stops,
  roomsById,
  buildings,
  graph,
  maxSnapMeters,
  bufferSeconds = 5 * 60,
}: EvaluateClassTransfersInput): ClassTransferEvaluation[] {
  if (!Number.isFinite(bufferSeconds) || bufferSeconds < 0) {
    throw new RangeError(
      "class transfer bufferSeconds must be a finite, non-negative number",
    );
  }

  const evaluations: ClassTransferEvaluation[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    const gapSeconds = (to.startMinutes - from.endMinutes) * 60;

    if (from.roomId === null) {
      evaluations.push(
        unknownEvaluation(i, from, to, "origin-room-unresolved", null),
      );
      continue;
    }
    if (to.roomId === null) {
      evaluations.push(
        unknownEvaluation(i, from, to, "destination-room-unresolved", null),
      );
      continue;
    }

    const originRoom = roomsById.get(from.roomId);
    if (!originRoom) {
      evaluations.push(
        unknownEvaluation(i, from, to, "origin-room-unresolved", null),
      );
      continue;
    }
    const destinationRoom = roomsById.get(to.roomId);
    if (!destinationRoom) {
      evaluations.push(
        unknownEvaluation(i, from, to, "destination-room-unresolved", null),
      );
      continue;
    }

    const roomTransfer = routeRoomTransfer({
      graph,
      originRoom,
      destinationRoom,
      buildings,
      maxSnapMeters,
    });
    const transferSeconds = roomTransfer.outdoorSeconds;
    if (transferSeconds === null) {
      evaluations.push(
        unknownEvaluation(
          i,
          from,
          to,
          roomTransfer.status as ClassTransferUnknownReason,
          roomTransfer,
        ),
      );
      continue;
    }

    const slack = classifySlack(gapSeconds, transferSeconds, bufferSeconds);
    evaluations.push({
      fromStopIndex: i,
      toStopIndex: i + 1,
      originRoomId: from.roomId,
      destinationRoomId: to.roomId,
      gapSeconds,
      estimatedTransferSeconds: transferSeconds,
      ...slack,
      unknownReason: null,
      roomTransfer,
    });
  }
  return evaluations;
}
