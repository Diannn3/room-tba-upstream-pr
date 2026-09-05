import { describe, expect, test } from "vitest";
import {
  ClassTransferStore,
  type ClassTransferPlanner,
} from "./class-transfer-store.svelte";
import type { ScheduleMatchResult } from "@lib/schedule-import/types";

const match = (
  courseCode: string,
  schedule: string,
  roomId: number | null,
  unresolvedReason: string | null = null,
): ScheduleMatchResult => ({
  row: {
    courseCode,
    section: "A",
    type: "LEC",
    schedule: [schedule],
  },
  matchedClassId: roomId,
  roomId,
  roomCode: roomId === null ? null : `ROOM ${roomId}`,
  coords: roomId === null ? null : [121.24, 14.16],
  unresolvedReason,
});

const matches = [
  match("FIRST 1", "M 08:00AM-09:00AM", 1),
  match("UNKNOWN 1", "M 09:10AM-10:00AM", null, "Room TBA"),
  match("LAST 1", "M 10:10AM-11:00AM", 2),
];

const buildings = [
  { id: 10, buildingName: "Origin Hall", lat: 14.16, lon: 121.24 },
];

describe("ClassTransferStore", () => {
  test("passes the full chronological class sequence, including unresolved venues", async () => {
    let seenCourseCodes: string[] = [];
    const planner: ClassTransferPlanner = async (input) => {
      seenCourseCodes = input.stops.map((stop) => stop.courseCode);
      return {
        status: "ready",
        evaluations: [],
        roomSourceIssues: new Map(),
      };
    };
    const store = new ClassTransferStore(planner);

    await store.refresh({ matches, weekday: "M", buildings });
    expect(store.phase).toBe("ready");
    expect(seenCourseCodes).toEqual(["FIRST 1", "UNKNOWN 1", "LAST 1"]);
    expect(store.stops).toHaveLength(3);
  });

  test("surfaces graph-unavailable separately from an unexpected planner error", async () => {
    const unavailable = new ClassTransferStore(async () => ({
      status: "graph-unavailable",
      evaluations: [],
      roomSourceIssues: new Map(),
    }));
    await unavailable.refresh({ matches, weekday: "M", buildings });
    expect(unavailable.phase).toBe("unavailable");

    const errored = new ClassTransferStore(async () => {
      throw new Error("unexpected");
    });
    await errored.refresh({ matches, weekday: "M", buildings });
    expect(errored.phase).toBe("error");
    expect(errored.result).toBeNull();
  });

  test("clear invalidates an in-flight result", async () => {
    let resolvePlanner:
      | ((value: Awaited<ReturnType<ClassTransferPlanner>>) => void)
      | null = null;
    const planner: ClassTransferPlanner = () =>
      new Promise((resolve) => {
        resolvePlanner = resolve;
      });
    const store = new ClassTransferStore(planner);

    const pending = store.refresh({ matches, weekday: "M", buildings });
    expect(store.phase).toBe("planning");
    store.clear();
    resolvePlanner?.({
      status: "ready",
      evaluations: [],
      roomSourceIssues: new Map(),
    });
    await pending;

    expect(store.phase).toBe("idle");
    expect(store.result).toBeNull();
    expect(store.stops).toEqual([]);
  });
});
