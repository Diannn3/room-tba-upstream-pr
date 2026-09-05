import { describe, expect, test } from "bun:test";
import {
  buildingApiUrl,
  parseBuildingRouteApiRows,
} from "./building-route-api-source";

describe("building route API source", () => {
  test("normalizes deployment URLs to the public buildings endpoint", () => {
    expect(buildingApiUrl("https://www.uplb.tools/")).toBe(
      "https://www.uplb.tools/api/buildings",
    );
    expect(buildingApiUrl("https://example.test/api/buildings")).toBe(
      "https://example.test/api/buildings",
    );
  });

  test("parses numeric database strings without changing null coordinates", () => {
    expect(
      parseBuildingRouteApiRows([
        {
          id: "61",
          buildingName: "Example Building",
          lat: "14.161",
          lon: "121.243",
        },
        {
          id: 62,
          buildingName: "No Pin Yet",
          lat: null,
          lon: null,
        },
      ]),
    ).toEqual([
      {
        id: 61,
        buildingName: "Example Building",
        lat: 14.161,
        lon: 121.243,
      },
      {
        id: 62,
        buildingName: "No Pin Yet",
        lat: null,
        lon: null,
      },
    ]);
  });

  test("rejects malformed identity and coordinate rows", () => {
    expect(() => parseBuildingRouteApiRows({})).toThrow(/array/i);
    expect(() => parseBuildingRouteApiRows([{ id: 1, lat: 14, lon: 121 }])).toThrow(
      /buildingName/i,
    );
    expect(() =>
      parseBuildingRouteApiRows([
        { id: 1, buildingName: "Bad", lat: "north", lon: 121 },
      ]),
    ).toThrow(/lat is not finite/i);
  });
});
