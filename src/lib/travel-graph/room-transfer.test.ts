import { describe, expect, test } from "bun:test";
import { buildTravelGraph } from "./engine";
import { routeRoomTransfer } from "./room-transfer";

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

const room = (id: number, buildingId: number | null) => ({
  id,
  code: `ROOM ${id}`,
  buildingId,
});

describe("routeRoomTransfer", () => {
  test("same exact room is a zero transfer", () => {
    const result = routeRoomTransfer({
      graph,
      originRoom: room(1, 10),
      destinationRoom: room(1, 10),
      buildings,
      maxSnapMeters: 250,
    });
    expect(result.status).toBe("same-room");
    expect(result.outdoorMeters).toBe(0);
    expect(result.outdoorSeconds).toBe(0);
    expect(result.buildingRoute).toBeNull();
  });

  test("different rooms in the same building are unknown, never zero", () => {
    const result = routeRoomTransfer({
      graph,
      originRoom: room(1, 10),
      destinationRoom: room(2, 10),
      buildings,
      maxSnapMeters: 250,
    });
    expect(result.status).toBe("same-building-indoor-unknown");
    expect(result.outdoorMeters).toBeNull();
    expect(result.outdoorSeconds).toBeNull();
    expect(result.buildingRoute).toBeNull();
  });

  test("fails closed when either room has no parent building", () => {
    expect(
      routeRoomTransfer({
        graph,
        originRoom: room(1, null),
        destinationRoom: room(2, 20),
        buildings,
        maxSnapMeters: 250,
      }).status,
    ).toBe("origin-building-unassigned");
    expect(
      routeRoomTransfer({
        graph,
        originRoom: room(1, 10),
        destinationRoom: room(2, null),
        buildings,
        maxSnapMeters: 250,
      }).status,
    ).toBe("destination-building-unassigned");
  });

  test("fails closed when a referenced parent building is absent", () => {
    expect(
      routeRoomTransfer({
        graph,
        originRoom: room(1, 99),
        destinationRoom: room(2, 20),
        buildings,
        maxSnapMeters: 250,
      }).status,
    ).toBe("origin-building-missing");
    expect(
      routeRoomTransfer({
        graph,
        originRoom: room(1, 10),
        destinationRoom: room(2, 99),
        buildings,
        maxSnapMeters: 250,
      }).status,
    ).toBe("destination-building-missing");
  });

  test("delegates cross-building outdoor distance and time to the building router", () => {
    const result = routeRoomTransfer({
      graph,
      originRoom: room(1, 10),
      destinationRoom: room(2, 20),
      buildings,
      maxSnapMeters: 250,
    });
    expect(result.status).toBe("ok");
    expect(result.buildingRoute?.status).toBe("ok");
    expect(result.outdoorMeters).toBeCloseTo(108, 6);
    expect(result.outdoorSeconds).toBeCloseTo(108 / 1.25, 6);
  });

  test("maps invalid and off-network building states without inventing a fallback", () => {
    const invalid = routeRoomTransfer({
      graph,
      originRoom: room(1, 10),
      destinationRoom: room(2, 20),
      buildings: [buildings[0], { ...buildings[1], lat: null }],
      maxSnapMeters: 250,
    });
    expect(invalid.status).toBe("destination-building-invalid");
    expect(invalid.outdoorMeters).toBeNull();

    const offNetwork = routeRoomTransfer({
      graph,
      originRoom: room(1, 10),
      destinationRoom: room(2, 20),
      buildings: [
        buildings[0],
        { ...buildings[1], lat: 14.2, lon: 121.3 },
      ],
      maxSnapMeters: 20,
    });
    expect(offNetwork.status).toBe("destination-off-network");
    expect(offNetwork.outdoorMeters).toBeNull();
  });

  test("rejects duplicate building identities instead of choosing arbitrarily", () => {
    expect(() =>
      routeRoomTransfer({
        graph,
        originRoom: room(1, 10),
        destinationRoom: room(2, 20),
        buildings: [...buildings, { ...buildings[0] }],
        maxSnapMeters: 250,
      }),
    ).toThrow(/duplicate building id 10/i);
  });
});
