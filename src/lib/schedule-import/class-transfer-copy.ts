import type { ClassTransferEvaluation } from "./class-transfer";
import type { ScheduleDayStop } from "./types";

export type ClassTransferTone = "good" | "caution" | "risk" | "muted";

export type ClassTransferPresentation = {
  headline: string;
  detail: string;
  tone: ClassTransferTone;
};

function roundedMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(Math.abs(seconds) / 60));
}

function gapLabel(gapSeconds: number): string {
  if (gapSeconds < 0) return `${roundedMinutes(gapSeconds)} min overlap`;
  if (gapSeconds === 0) return "no gap";
  return `${roundedMinutes(gapSeconds)} min gap`;
}

function walkLabel(seconds: number): string {
  if (seconds <= 0) return "no walk";
  return `about ${roundedMinutes(seconds)} min walk`;
}

function roomLabel(stop: ScheduleDayStop): string {
  return stop.roomCode ?? "Room TBA";
}

/**
 * Product copy for one adjacent class transfer.
 *
 * Deliberately avoids certainty language such as "impossible". Cross-building
 * times describe the estimated outdoor walk only; same-building different-room
 * transfers explicitly remain unknown because there is no indoor route model.
 */
export function presentClassTransfer(
  evaluation: ClassTransferEvaluation,
  from: ScheduleDayStop,
  to: ScheduleDayStop,
): ClassTransferPresentation {
  const gap = gapLabel(evaluation.gapSeconds);
  const pair = `${roomLabel(from)} → ${roomLabel(to)}`;

  if (evaluation.assessment === "unknown") {
    if (evaluation.unknownReason === "same-building-indoor-unknown") {
      return {
        headline: "Indoor transfer not estimated",
        detail: `${pair} · ${gap}. These rooms are in the same building; Room TBA does not model indoor corridors or entrances.`,
        tone: "muted",
      };
    }

    if (
      evaluation.unknownReason === "origin-room-unresolved" ||
      evaluation.unknownReason === "destination-room-unresolved"
    ) {
      return {
        headline: "Transfer time unavailable",
        detail: `${pair} · ${gap}. One of these classes does not have a resolved room in Room TBA.`,
        tone: "muted",
      };
    }

    if (
      evaluation.unknownReason === "origin-building-unassigned" ||
      evaluation.unknownReason === "destination-building-unassigned" ||
      evaluation.unknownReason === "origin-building-missing" ||
      evaluation.unknownReason === "destination-building-missing" ||
      evaluation.unknownReason === "origin-building-invalid" ||
      evaluation.unknownReason === "destination-building-invalid"
    ) {
      return {
        headline: "Transfer time unavailable",
        detail: `${pair} · ${gap}. A room's parent building is missing or does not have a usable map pin.`,
        tone: "muted",
      };
    }

    return {
      headline: "Transfer time unavailable",
      detail: `${pair} · ${gap}. The mapped campus walking network cannot provide this outdoor transfer estimate.`,
      tone: "muted",
    };
  }

  if (evaluation.roomTransfer?.status === "same-room") {
    return {
      headline: `Same room · ${gap}`,
      detail:
        evaluation.gapSeconds < 0
          ? `${pair}. The classes overlap in time, although no walking transfer is needed.`
          : `${pair}. No walking transfer is needed.`,
      tone: evaluation.assessment === "likely-insufficient" ? "risk" : "good",
    };
  }

  const walk = walkLabel(evaluation.estimatedTransferSeconds ?? 0);
  const headline = `${walk} · ${gap}`;
  switch (evaluation.assessment) {
    case "comfortable":
      return {
        headline,
        detail: `${pair}. Comfortable with the planning buffer after the estimated outdoor walk.`,
        tone: "good",
      };
    case "tight":
      return {
        headline,
        detail: `${pair}. Tight — the estimated outdoor walk fits, but not with the full planning buffer.`,
        tone: "caution",
      };
    case "likely-insufficient":
      return {
        headline,
        detail: `${pair}. Likely not enough time for the estimated outdoor walk.`,
        tone: "risk",
      };
    case "unknown":
      // Handled above; keeps the switch exhaustive if the union changes.
      return {
        headline: "Transfer time unavailable",
        detail: `${pair} · ${gap}.`,
        tone: "muted",
      };
  }
}
