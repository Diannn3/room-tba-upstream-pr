import { describe, expect, test } from "bun:test";
import { buildTravelGraph } from "@lib/travel-graph/engine";
import type { RoomTransferSourceResolution } from "./room-transfer-source";
import {
  planClassTransfers,
  type ClassTransferPlanDependencies,
} from "./class-transfer-plan";
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

const stops: ScheduleDayStop[] = [
  {
    courseCode: "TEST 1",
    section: "A",
    type: "LEC",
    scheduleSlot: "M 08:00AM-09:00AM",
    roomId: 1,
    roomCode: "A 101",
    coords: [121.24, 14.16],
    startMinutes: 8 * 60,
    endMinutes: 9 * 60,
    gapMinutesAfter: 10,
  },
  {
    courseCode: "TEST 2",
    section: "B",
    type: "LEC",
    scheduleSlot: "M 09:10AM-10:00AM",
    roomId: 2,
    roomCode: "B 201",
    coords: [121.241, 14.16],
    startMinutes: 9 * 60 + 10,
    endMinutes: 10 * 60,
    gapMinutesAfter: null,
  },
];

const roomResolution: RoomTransferSourceResolution = {
  roomsById: new Map([
    [1, { id: 1, code: "A 101", buildingId: 10 }],
    [2, { id: 2, code: "B 201", buildingId: 20 }],
  ]),
  issuesByRoomId: new Map(),
};

describe("planClassTransfers", () => {
  test("reuses resolved rooms and the canonical walk graph to evaluate transfers", async () => {
    let graphLoads = 0;
    let roomResolutions = 0;
    const dependencies: ClassTransferPlanDependencies = {
      loadGraph: async () => {
        graphLoads += 1;
        return graph;
      },
      resolveRooms: async () => {
        roomResolutions += 1;
        return roomResolution;
      },
    };

    const result = await planClassTransfers({ stops, buildings }, dependencies);
    expect(result.status).toBe("ready");
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].assessment).toBe("comfortable");
    expect(result.evaluations[0].estimatedTransferSeconds).toBeCloseTo(86.4, 5);
    expect(graphLoads).toBe(1);
    expect(roomResolutions).toBe(1);
  });

  test("skips room and graph work when no adjacent transfer exists", async () => {
    let graphLoads = 0;
    let roomResolutions = 0;
    const dependencies: ClassTransferPlanDependencies = {
      loadGraph: async () => {
        graphLoads += 1;
        return graph;
      },
      resolveRooms: async () => {
        roomResolutions += 1;
        return roomResolution;
      },
    };

    for (const noPair of [[], stops.slice(0, 1)]) {
      const result = await planClassTransfers(
        { stops: noPair, buildings },
        dependencies,
      );
      expect(result.status).toBe("ready");
      expect(result.evaluations).toEqual([]);
      expect(result.roomSourceIssues.size).toBe(0);
    }
    expect(graphLoads).toBe(0);
    expect(roomResolutions).toBe(0);
  });

  test("fails closed when the vendored graph cannot load", async () => {
    const issues = new Map([[1, "not-found" as const]]);
    const dependencies: ClassTransferPlanDependencies = {
      loadGraph: async () => {
        throw new Error("chunk unavailable");
      },
      resolveRooms: async () => ({
        roomsById: new Map(),
        issuesByRoomId: issues,
      }),
    };

    const result = await planClassTransfers({ stops, buildings }, dependencies);
    expect(result.status).toBe("graph-unavailable");
    expect(result.evaluations).toEqual([]);
    expect(result.roomSourceIssues).toBe(issues);
  });

  test("passes an explicit planning buffer through without creating another routing policy", async () => {
    const dependencies: ClassTransferPlanDependencies = {
      loadGraph: async () => graph,
      resolveRooms: async () => roomResolution,
    };
    const result = await planClassTransfers(
      { stops, buildings, bufferSeconds: 10 * 60 },
      dependencies,
    );
    expect(result.status).toBe("ready");
    expect(result.evaluations[0].assessment).toBe("tight");
  });
});
