import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import TodayScreen from "@test/components/TodayScreenHost.svelte";
import {
  classTransferStore,
  plannerStore,
  queryStore,
  scheduleRouteStore,
  sidebarStore,
  termStore,
} from "@lib/store.svelte";
import { mountAtWidth } from "@test/layout-assertions";
import type { ClassMapValue } from "@lib/types";

const row = (overrides: Partial<ClassMapValue> = {}): ClassMapValue => ({
  id: 1,
  courseCode: "CMSC 128",
  section: "AB-1L",
  type: "LEC",
  schedule: ["MW 07:00AM-08:00AM"],
  roomCode: "ICS MH1",
  directions: null,
  courseTitle: "Software Engineering",
  roomId: 1,
  termId: 1252,
  ...overrides,
});

describe("TodayScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-27T04:00:00Z")); // Monday noon in Manila
    localStorage.clear();
    termStore.activeTermId = 1252;
    plannerStore.plans = [];
    plannerStore.activePlanIdByTerm = {};
    scheduleRouteStore.clearImport();
    scheduleRouteStore.pendingDayRoute = false;
    classTransferStore.clear();
    sidebarStore.changeOpened("today");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("points an empty planner at the Planner instead of a blank screen", async () => {
    render(TodayScreen);
    expect(screen.getByText(/Add classes to see your day/)).toBeVisible();

    await fireEvent.click(
      screen.getByRole("button", { name: "Open the Planner" }),
    );
    expect(sidebarStore.panelOpen).toBe("planner");
  });

  test("lists today's classes in time order with a room link", async () => {
    plannerStore.addOffering([row({ schedule: ["M 03:00PM-05:00PM"] })]);
    plannerStore.addOffering([
      row({
        id: 2,
        courseCode: "MATH 27",
        section: "B-2",
        schedule: ["MW 07:00AM-08:00AM"],
        roomCode: "MB 101",
      }),
    ]);
    mountAtWidth(320);
    render(TodayScreen);

    const today = screen.getByRole("region", { name: /^Today,/ });
    expect(
      [...today.querySelectorAll(".today-entry__time")].map((el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(["7:00 AM – 8:00 AM", "3:00 PM – 5:00 PM"]);

    await fireEvent.click(
      today.querySelector<HTMLButtonElement>(".today-entry__room")!,
    );
    expect(queryStore.category).toBe("room");
    expect(queryStore.queryValue).toBe("MB 101");
    expect(sidebarStore.panelOpen).toBe("map");
  });

  test("Route my day is enabled when today has classes", () => {
    plannerStore.addOffering([row({ schedule: ["M 07:00AM-08:00AM"] })]);
    render(TodayScreen);

    expect(screen.getByRole("button", { name: /Route my day/ })).toBeEnabled();
  });

  test("Route my day is disabled with a hint when today has no classes", () => {
    plannerStore.addOffering([row({ schedule: ["T 07:00AM-08:00AM"] })]);
    render(TodayScreen);

    expect(screen.getByRole("button", { name: /Route my day/ })).toBeDisabled();
    expect(screen.getByText("No classes to route today.")).toBeVisible();
  });

  test("Route my day is disabled with a Planner hint when there is no plan", () => {
    render(TodayScreen);

    expect(screen.getByRole("button", { name: /Route my day/ })).toBeDisabled();
    expect(screen.getByText("Add classes in the Planner first.")).toBeVisible();
  });

  test("Check transfers requires at least two classes", () => {
    plannerStore.addOffering([row({ schedule: ["M 07:00AM-08:00AM"] })]);
    render(TodayScreen);

    expect(screen.getByRole("button", { name: /Check transfers/ })).toBeDisabled();
    expect(
      screen.getByText("At least two classes are needed for a transfer check."),
    ).toBeVisible();
  });

  test("renders honest same-building transfer copy after an explicit check", async () => {
    plannerStore.addOffering([row({ schedule: ["M 07:00AM-08:00AM"] })]);
    plannerStore.addOffering([
      row({
        id: 2,
        courseCode: "MATH 27",
        section: "B-2",
        schedule: ["M 08:10AM-09:00AM"],
        roomCode: "ICS MH2",
        roomId: 2,
      }),
    ]);

    vi.spyOn(scheduleRouteStore, "importFromPlanner").mockResolvedValue(true);
    vi.spyOn(classTransferStore, "refresh").mockImplementation(async ({ weekday }) => {
      classTransferStore.weekday = weekday;
      classTransferStore.stops = [
        {
          courseCode: "CMSC 128",
          section: "AB-1L",
          type: "LEC",
          scheduleSlot: "M 07:00AM-08:00AM",
          roomId: 1,
          roomCode: "ICS MH1",
          coords: [121.24, 14.16],
          startMinutes: 7 * 60,
          endMinutes: 8 * 60,
          gapMinutesAfter: 10,
        },
        {
          courseCode: "MATH 27",
          section: "B-2",
          type: "LEC",
          scheduleSlot: "M 08:10AM-09:00AM",
          roomId: 2,
          roomCode: "ICS MH2",
          coords: [121.24, 14.16],
          startMinutes: 8 * 60 + 10,
          endMinutes: 9 * 60,
          gapMinutesAfter: null,
        },
      ];
      classTransferStore.result = {
        status: "ready",
        evaluations: [
          {
            fromStopIndex: 0,
            toStopIndex: 1,
            originRoomId: 1,
            destinationRoomId: 2,
            gapSeconds: 10 * 60,
            estimatedTransferSeconds: null,
            rawSlackSeconds: null,
            bufferedSlackSeconds: null,
            assessment: "unknown",
            unknownReason: "same-building-indoor-unknown",
            roomTransfer: null,
          },
        ],
        roomSourceIssues: new Map(),
      };
      classTransferStore.phase = "ready";
    });

    render(TodayScreen);
    await fireEvent.click(
      screen.getByRole("button", { name: /Check transfers/ }),
    );

    await waitFor(() => {
      expect(screen.getByText("Today’s transfers")).toBeVisible();
    });
    expect(screen.getByText("Indoor transfer not estimated")).toBeVisible();
    expect(screen.getByText(/does not model indoor corridors/i)).toBeVisible();
    expect(screen.queryByText(/0 min/i)).not.toBeInTheDocument();
  });

  test("renders an explicit empty state per day and a distinct Sunday", () => {
    plannerStore.addOffering([row({ schedule: ["M 07:00AM-08:00AM"] })]);
    render(TodayScreen);

    const tomorrow = screen.getByRole("region", { name: /^Tomorrow,/ });
    expect(
      tomorrow.querySelector(".today-day__empty")?.textContent?.trim(),
    ).toBe("No classes.");

    const sunday = screen.getByRole("region", { name: /^Sunday,/ });
    expect(sunday).toHaveClass("today-day--weekend");
    expect(sunday.querySelector(".today-day__empty")?.textContent?.trim()).toBe(
      "No classes on Sundays.",
    );
  });
});
