import type { BuildingRouteEndpoint } from "@lib/travel-graph/building-route";
import {
  planClassTransfers,
  type ClassTransferPlanResult,
  type PlanClassTransfersInput,
} from "@lib/schedule-import/class-transfer-plan";
import { orderDayTransferStops } from "@lib/schedule-import/day-stops";
import type {
  ScheduleDayStop,
  ScheduleMatchResult,
  Weekday,
} from "@lib/schedule-import/types";

export type ClassTransferPhase =
  | "idle"
  | "planning"
  | "ready"
  | "unavailable"
  | "error";

export type ClassTransferPlanner = (
  input: PlanClassTransfersInput,
) => Promise<ClassTransferPlanResult>;

export type RefreshClassTransfersInput = {
  matches: ScheduleMatchResult[];
  weekday: Weekday;
  buildings: readonly BuildingRouteEndpoint[];
  bufferSeconds?: number;
};

/**
 * UI/session state for adjacent class-transfer estimates.
 *
 * This store deliberately does not own routing policy or route math. It only
 * derives chronological transfer stops, guards stale async results, and keeps
 * the canonical planner result separate from the legacy OSRM day-route totals.
 */
export class ClassTransferStore {
  phase: ClassTransferPhase = $state("idle");
  weekday: Weekday | null = $state(null);
  stops: ScheduleDayStop[] = $state([]);
  result: ClassTransferPlanResult | null = $state(null);
  #refreshToken = 0;
  #planner: ClassTransferPlanner;

  constructor(planner: ClassTransferPlanner = planClassTransfers) {
    this.#planner = planner;
  }

  get evaluations() {
    return this.result?.status === "ready" ? this.result.evaluations : [];
  }

  clear = () => {
    this.#refreshToken += 1;
    this.phase = "idle";
    this.weekday = null;
    this.stops = [];
    this.result = null;
  };

  refresh = async ({
    matches,
    weekday,
    buildings,
    bufferSeconds,
  }: RefreshClassTransfersInput) => {
    const token = ++this.#refreshToken;
    this.weekday = weekday;
    this.stops = orderDayTransferStops(matches, weekday);
    this.result = null;
    this.phase = "planning";

    try {
      const result = await this.#planner({
        stops: this.stops,
        buildings,
        ...(bufferSeconds === undefined ? {} : { bufferSeconds }),
      });
      if (token !== this.#refreshToken) return;

      this.result = result;
      this.phase = result.status === "ready" ? "ready" : "unavailable";
    } catch {
      if (token !== this.#refreshToken) return;
      this.result = null;
      this.phase = "error";
    }
  };
}

export const classTransferStore = new ClassTransferStore();
