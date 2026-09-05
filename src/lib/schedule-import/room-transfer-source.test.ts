import { describe, expect, test } from "bun:test";
import type { ScheduleDayStop } from "./types";
import {
  resolveRoomTransferEndpoint,
  resolveTransferRoomsForStops,
  type RoomTransferSourceDependencies,
} from "./room-transfer-source";

const stop = (roomId: number | null, roomCode: string | null): ScheduleDayStop => ({
  courseCode: "TEST 1",
  section: "A",
  type: "LEC",
  scheduleSlot: "M 08:00AM-09:00AM",
  roomId,
  roomCode,
  coords: [121.24, 14.16],
  startMinutes: 8 * 60,
  endMinutes: 9 * 60,
  gapMinutesAfter: null,
});

describe("room transfer source", () => {
  test("prefers local room-by-id data and avoids the remote fallback", async () => {
    let remoteCalls = 0;
    const dependencies: RoomTransferSourceDependencies = {
      getLocalById: async (id) => ({ id, code: "LOCAL 101", buildingId: 10 }),
      getRemoteByCode: async () => {
        remoteCalls += 1;
        return { id: 1, code: "REMOTE 101", buildingId: 20 };
      },
    };
    const resolved = await resolveRoomTransferEndpoint(1, "REMOTE 101", dependencies);
    expect(resolved).toEqual({
      room: { id: 1, code: "LOCAL 101", buildingId: 10 },
      issue: null,
    });
    expect(remoteCalls).toBe(0);
  });

  test("falls back by room code but rejects a different returned room id", async () => {
    const dependencies: RoomTransferSourceDependencies = {
      getLocalById: async () => null,
      getRemoteByCode: async () => ({
        id: 99,
        code: "ICS 314",
        buildingId: 10,
      }),
    };
    const resolved = await resolveRoomTransferEndpoint(1, "ics 314", dependencies);
    expect(resolved.room).toBeNull();
    expect(resolved.issue).toBe("identity-mismatch");
  });

  test("reports missing room codes when local data is unavailable", async () => {
    const dependencies: RoomTransferSourceDependencies = {
      getLocalById: async () => null,
      getRemoteByCode: async () => null,
    };
    const resolved = await resolveRoomTransferEndpoint(1, null, dependencies);
    expect(resolved).toEqual({ room: null, issue: "missing-room-code" });
  });

  test("deduplicates repeated room ids to one lookup", async () => {
    const calls = new Map<number, number>();
    const dependencies: RoomTransferSourceDependencies = {
      getLocalById: async (id) => {
        calls.set(id, (calls.get(id) ?? 0) + 1);
        return { id, code: `ROOM ${id}`, buildingId: id * 10 };
      },
      getRemoteByCode: async () => null,
    };
    const result = await resolveTransferRoomsForStops(
      [stop(1, "ROOM 1"), stop(1, "ROOM 1"), stop(2, "ROOM 2")],
      dependencies,
    );
    expect(result.roomsById.size).toBe(2);
    expect(calls.get(1)).toBe(1);
    expect(calls.get(2)).toBe(1);
    expect(result.issuesByRoomId.size).toBe(0);
  });

  test("fails closed on conflicting room codes for one room id", async () => {
    let calls = 0;
    const dependencies: RoomTransferSourceDependencies = {
      getLocalById: async () => {
        calls += 1;
        return null;
      },
      getRemoteByCode: async () => null,
    };
    const result = await resolveTransferRoomsForStops(
      [stop(1, "ICS 314"), stop(1, "ICS 316")],
      dependencies,
    );
    expect(result.roomsById.has(1)).toBe(false);
    expect(result.issuesByRoomId.get(1)).toBe("conflicting-room-code");
    expect(calls).toBe(0);
  });

  test("keeps unassigned parent buildings as valid resolved room identities", async () => {
    const dependencies: RoomTransferSourceDependencies = {
      getLocalById: async (id) => ({ id, code: "TBA ROOM", buildingId: null }),
      getRemoteByCode: async () => null,
    };
    const result = await resolveTransferRoomsForStops(
      [stop(1, "TBA ROOM")],
      dependencies,
    );
    expect(result.roomsById.get(1)?.buildingId).toBeNull();
    expect(result.issuesByRoomId.size).toBe(0);
  });
});
