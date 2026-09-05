import { describe, expect, test } from "bun:test";
import { buildTravelGraph } from "@lib/travel-graph/engine";
import type { RoomTransferEndpoint } from "@lib/travel-graph/room-transfer";
import { evaluateClassTransfers } from "./class-transfer";
import type { ScheduleDayStop } from "./types";

const graph = buildTravelGraph({
  meta: { coordScale: 1_000_000, nodeCount: 2, edgeCount: 1 },
  nodes: [
    [1, 14.16, 121.24],
    [2, 14.16, 121.241],
  ],
  edges: [[0, 1, 108, "footway", null, []]],
});

const buildings = [
  { id: 10, buildingName: "Origin Hall", lat: 14.16, lon: 121.24 },
  { id: 20, buildingName: "Destination Hall", lat: 14.16, lon: 121.241 },
];

const rooms = new Map<number, RoomTransferEndpoint>([
  [1, { id: 1, code: "A 101", buildingId: 10 }],
  [2, { id: 2, code: "B 201", buildingId: 20 }],
  [3, { id: 3, code: "A 102", buildingId: 10 }],
]);

const stop = (
  roomId: number | null,
  startMinutes: number,
  endMinutes: number,
): ScheduleDayStop => ({
  courseCode: "TEST 1",
  section: "A",
  type: "LEC",
  scheduleSlot: "M 08:00AM-09:00AM",
  roomId,
  roomCode: roomId === null ? null : `ROOM ${roomId}`,
  coords: [121.24, 14.16],
  startMinutes,
  endMinutes,
  gapMinutesAfter: null,
});

describe("evaluateClassTransfers", () => {
  test("classifies comfortable, tight, and likely-insufficient cross-building gaps", () => {
    const comfortable = evaluateClassTransfers({
      stops: [stop(1, 8 * 60, 9 * 60), stop(2, 9 * 60 + 10, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(comfortable.assessment).toBe("comfortable");
    expect(comfortable.estimatedTransferSeconds).toBeCloseTo(86.4, 5);
    expect(comfortable.rawSlackSeconds).toBeCloseTo(513.6, 5);
    expect(comfortable.bufferedSlackSeconds).toBeCloseTo(213.6, 5);

    const tight = evaluateClassTransfers({
      stops: [stop(1, 8 * 60, 9 * 60), stop(2, 9 * 60 + 5, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(tight.assessment).toBe("tight");
    expect(tight.rawSlackSeconds).toBeGreaterThanOrEqual(0);
    expect(tight.bufferedSlackSeconds).toBeLessThan(0);

    const insufficient = evaluateClassTransfers({
      stops: [stop(1, 8 * 60, 9 * 60), stop(2, 9 * 60 + 1, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(insufficient.assessment).toBe("likely-insufficient");
    expect(insufficient.rawSlackSeconds).toBeLessThan(0);
  });

  test("same exact room uses zero transfer time but still respects the buffer", () => {
    const fourMinutes = evaluateClassTransfers({
      stops: [stop(1, 8 * 60, 9 * 60), stop(1, 9 * 60 + 4, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(fourMinutes.roomTransfer?.status).toBe("same-room");
    expect(fourMinutes.estimatedTransferSeconds).toBe(0);
    expect(fourMinutes.assessment).toBe("tight");

    const fiveMinutes = evaluateClassTransfers({
      stops: [stop(1, 8 * 60, 9 * 60), stop(1, 9 * 60 + 5, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(fiveMinutes.assessment).toBe("comfortable");
  });

  test("different rooms in one building stay unknown rather than receiving zero", () => {
    const result = evaluateClassTransfers({
      stops: [stop(1, 8 * 60, 9 * 60), stop(3, 9 * 60 + 30, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(result.assessment).toBe("unknown");
    expect(result.estimatedTransferSeconds).toBeNull();
    expect(result.unknownReason).toBe("same-building-indoor-unknown");
  });

  test("unresolved room identities stay unknown", () => {
    const originUnknown = evaluateClassTransfers({
      stops: [stop(null, 8 * 60, 9 * 60), stop(2, 9 * 60 + 10, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(originUnknown.assessment).toBe("unknown");
    expect(originUnknown.unknownReason).toBe("origin-room-unresolved");

    const missingResolvedRoom = evaluateClassTransfers({
      stops: [stop(99, 8 * 60, 9 * 60), stop(2, 9 * 60 + 10, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(missingResolvedRoom.unknownReason).toBe("origin-room-unresolved");
  });

  test("overlapping classes can be likely-insufficient even with no walking needed", () => {
    const result = evaluateClassTransfers({
      stops: [stop(1, 8 * 60, 9 * 60), stop(1, 8 * 60 + 55, 10 * 60)],
      roomsById: rooms,
      buildings,
      graph,
      maxSnapMeters: 250,
    })[0];
    expect(result.gapSeconds).toBe(-5 * 60);
    expect(result.estimatedTransferSeconds).toBe(0);
    expect(result.assessment).toBe("likely-insufficient");
  });

  test("rejects invalid negative or non-finite planning buffers", () => {
    for (const bufferSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        evaluateClassTransfers({
          stops: [stop(1, 8 * 60, 9 * 60), stop(2, 10 * 60, 11 * 60)],
          roomsById: rooms,
          buildings,
          graph,
          maxSnapMeters: 250,
          bufferSeconds,
        }),
      ).toThrow(/bufferSeconds/i);
    }
  });
});
