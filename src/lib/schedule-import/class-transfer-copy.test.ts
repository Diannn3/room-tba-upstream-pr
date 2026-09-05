import { describe, expect, test } from "bun:test";
import type { ClassTransferEvaluation } from "./class-transfer";
import { presentClassTransfer } from "./class-transfer-copy";
import type { ScheduleDayStop } from "./types";

const stop = (roomCode: string | null): ScheduleDayStop => ({
  courseCode: "TEST 1",
  section: "A",
  type: "LEC",
  scheduleSlot: "M 08:00AM-09:00AM",
  roomId: roomCode ? 1 : null,
  roomCode,
  coords: roomCode ? [121.24, 14.16] : null,
  startMinutes: 8 * 60,
  endMinutes: 9 * 60,
  gapMinutesAfter: null,
});

const baseEvaluation = (
  overrides: Partial<ClassTransferEvaluation>,
): ClassTransferEvaluation => ({
  fromStopIndex: 0,
  toStopIndex: 1,
  originRoomId: 1,
  destinationRoomId: 2,
  gapSeconds: 10 * 60,
  estimatedTransferSeconds: 2 * 60,
  rawSlackSeconds: 8 * 60,
  bufferedSlackSeconds: 3 * 60,
  assessment: "comfortable",
  unknownReason: null,
  roomTransfer: null,
  ...overrides,
});

describe("presentClassTransfer", () => {
  test("uses cautious outdoor wording for comfortable and tight estimates", () => {
    const from = stop("A 101");
    const to = stop("B 201");
    const comfortable = presentClassTransfer(baseEvaluation({}), from, to);
    expect(comfortable.headline).toBe("about 2 min walk · 10 min gap");
    expect(comfortable.detail).toContain("estimated outdoor walk");
    expect(comfortable.tone).toBe("good");

    const tight = presentClassTransfer(
      baseEvaluation({
        gapSeconds: 4 * 60,
        rawSlackSeconds: 2 * 60,
        bufferedSlackSeconds: -3 * 60,
        assessment: "tight",
      }),
      from,
      to,
    );
    expect(tight.detail).toContain("Tight");
    expect(tight.tone).toBe("caution");
  });

  test("never turns different rooms in one building into a zero-minute claim", () => {
    const presentation = presentClassTransfer(
      baseEvaluation({
        estimatedTransferSeconds: null,
        rawSlackSeconds: null,
        bufferedSlackSeconds: null,
        assessment: "unknown",
        unknownReason: "same-building-indoor-unknown",
      }),
      stop("A 101"),
      stop("A 201"),
    );
    expect(presentation.headline).toBe("Indoor transfer not estimated");
    expect(presentation.detail).toContain("does not model indoor");
    expect(presentation.detail).not.toMatch(/0\s*min/i);
  });

  test("same exact room says no walking transfer while preserving schedule overlap", () => {
    const presentation = presentClassTransfer(
      baseEvaluation({
        gapSeconds: -5 * 60,
        estimatedTransferSeconds: 0,
        rawSlackSeconds: -5 * 60,
        bufferedSlackSeconds: -10 * 60,
        assessment: "likely-insufficient",
        roomTransfer: {
          status: "same-room",
          originRoomId: 1,
          destinationRoomId: 1,
          originBuildingId: 10,
          destinationBuildingId: 10,
          outdoorMeters: 0,
          outdoorSeconds: 0,
          buildingRoute: null,
        },
      }),
      stop("A 101"),
      stop("A 101"),
    );
    expect(presentation.headline).toBe("Same room · 5 min overlap");
    expect(presentation.detail).toContain("overlap in time");
    expect(presentation.detail).toContain("no walking transfer");
  });

  test("unresolved venues and off-network routes remain unavailable", () => {
    const unresolved = presentClassTransfer(
      baseEvaluation({
        estimatedTransferSeconds: null,
        rawSlackSeconds: null,
        bufferedSlackSeconds: null,
        assessment: "unknown",
        unknownReason: "destination-room-unresolved",
      }),
      stop("A 101"),
      stop(null),
    );
    expect(unresolved.headline).toBe("Transfer time unavailable");
    expect(unresolved.detail).toContain("resolved room");

    const offNetwork = presentClassTransfer(
      baseEvaluation({
        estimatedTransferSeconds: null,
        rawSlackSeconds: null,
        bufferedSlackSeconds: null,
        assessment: "unknown",
        unknownReason: "destination-off-network",
      }),
      stop("A 101"),
      stop("UPRHS 1"),
    );
    expect(offNetwork.detail).toContain("walking network");
  });

  test("uses likely-not-enough copy instead of impossible", () => {
    const presentation = presentClassTransfer(
      baseEvaluation({
        gapSeconds: 60,
        estimatedTransferSeconds: 2 * 60,
        rawSlackSeconds: -60,
        bufferedSlackSeconds: -6 * 60,
        assessment: "likely-insufficient",
      }),
      stop("A 101"),
      stop("B 201"),
    );
    expect(presentation.detail).toContain("Likely not enough time");
    expect(`${presentation.headline} ${presentation.detail}`).not.toMatch(
      /impossible/i,
    );
  });
});
