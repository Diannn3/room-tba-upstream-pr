import { describe, expect, it } from "bun:test";
import {
  formatMinutes,
  orderDayStops,
  orderDayTransferStops,
  parseSlotMinutes,
  scheduleSlotOnWeekday,
  tokenizeScheduleDays,
} from "./day-stops";
import type { ScheduleMatchResult } from "./types";

describe("tokenizeScheduleDays", () => {
  it("splits T and Th correctly", () => {
    expect(tokenizeScheduleDays("TTh")).toEqual(["T", "Th"]);
    expect(tokenizeScheduleDays("MWF")).toEqual(["M", "W", "F"]);
  });

  it("handles uppercase production tokens (TH not Th)", () => {
    expect(tokenizeScheduleDays("TTH")).toEqual(["T", "Th"]);
    expect(tokenizeScheduleDays("MTHF")).toEqual(["M", "Th", "F"]);
    expect(tokenizeScheduleDays("MTWTHFS")).toEqual([
      "M",
      "T",
      "W",
      "Th",
      "F",
      "S",
    ]);
  });
});

describe("scheduleSlotOnWeekday", () => {
  it("matches Tuesday but not Thursday for T slot", () => {
    expect(scheduleSlotOnWeekday("T 10:00AM-11:00AM", "T")).toBe(true);
    expect(scheduleSlotOnWeekday("T 10:00AM-11:00AM", "Th")).toBe(false);
  });

  it("matches Thursday for TTh slot", () => {
    expect(scheduleSlotOnWeekday("TTh 01:00PM-02:30PM", "Th")).toBe(true);
  });
});

describe("parseSlotMinutes", () => {
  it("parses AM and PM boundaries", () => {
    expect(parseSlotMinutes("MW 07:00AM-08:00AM")).toEqual({
      startMinutes: 7 * 60,
      endMinutes: 8 * 60,
    });
    expect(parseSlotMinutes("M 09:00AM-03:00PM")).toEqual({
      startMinutes: 9 * 60,
      endMinutes: 15 * 60,
    });
  });
});

describe("day stop ordering", () => {
  const baseMatch = (
    overrides: Partial<ScheduleMatchResult>,
  ): ScheduleMatchResult => ({
    row: {
      courseCode: "CMSC 123",
      section: "A",
      type: "LEC",
      schedule: ["MW 08:00AM-09:00AM"],
    },
    matchedClassId: 1,
    roomId: 10,
    roomCode: "ICS 314",
    coords: [121.077, 14.135],
    unresolvedReason: null,
    ...overrides,
  });

  it("orders routable stops by start time and computes gaps", () => {
    const matches: ScheduleMatchResult[] = [
      baseMatch({
        row: {
          courseCode: "CMSC 170",
          section: "B",
          type: "LAB",
          schedule: ["M 01:00PM-04:00PM"],
        },
        roomId: 20,
        roomCode: "ICS 316",
        coords: [121.078, 14.136],
      }),
      baseMatch({
        row: {
          courseCode: "CMSC 123",
          section: "A",
          type: "LEC",
          schedule: ["M 08:00AM-09:00AM"],
        },
      }),
    ];

    const stops = orderDayStops(matches, "M");
    expect(stops).toHaveLength(2);
    expect(stops[0].courseCode).toBe("CMSC 123");
    expect(stops[0].roomId).toBe(10);
    expect(stops[1].courseCode).toBe("CMSC 170");
    expect(stops[1].roomId).toBe(20);
    expect(stops[0].gapMinutesAfter).toBe(4 * 60);
  });

  it("keeps the existing map-route behavior of skipping unresolved rows", () => {
    const stops = orderDayStops(
      [
        baseMatch({
          coords: null,
          unresolvedReason: "No room",
        }),
      ],
      "M",
    );
    expect(stops).toHaveLength(0);
  });

  it("retains unresolved classes for transfer adjacency", () => {
    const matches: ScheduleMatchResult[] = [
      baseMatch({
        row: {
          courseCode: "FIRST 1",
          section: "A",
          type: "LEC",
          schedule: ["M 08:00AM-09:00AM"],
        },
      }),
      baseMatch({
        row: {
          courseCode: "UNKNOWN 1",
          section: "B",
          type: "LEC",
          schedule: ["M 09:10AM-10:00AM"],
        },
        matchedClassId: 2,
        roomId: null,
        roomCode: null,
        coords: null,
        unresolvedReason: "Matched section has no room assigned.",
      }),
      baseMatch({
        row: {
          courseCode: "LAST 1",
          section: "C",
          type: "LEC",
          schedule: ["M 10:10AM-11:00AM"],
        },
        matchedClassId: 3,
        roomId: 30,
        roomCode: "ICS 316",
        coords: [121.078, 14.136],
      }),
    ];

    const mapStops = orderDayStops(matches, "M");
    expect(mapStops.map((stop) => stop.courseCode)).toEqual([
      "FIRST 1",
      "LAST 1",
    ]);

    const transferStops = orderDayTransferStops(matches, "M");
    expect(transferStops.map((stop) => stop.courseCode)).toEqual([
      "FIRST 1",
      "UNKNOWN 1",
      "LAST 1",
    ]);
    expect(transferStops[1].roomId).toBeNull();
    expect(transferStops[0].gapMinutesAfter).toBe(10);
    expect(transferStops[1].gapMinutesAfter).toBe(10);
  });
});

describe("formatMinutes", () => {
  it("formats noon and half hours", () => {
    expect(formatMinutes(12 * 60)).toBe("12 PM");
    expect(formatMinutes(13 * 60 + 30)).toBe("1:30 PM");
  });
});
