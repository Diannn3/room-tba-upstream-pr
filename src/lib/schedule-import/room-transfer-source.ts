import { getJSONFetch, getLocalRoomById } from "@lib/local/data/utils";
import type { RoomData } from "@lib/types";
import type { RoomTransferEndpoint } from "@lib/travel-graph/room-transfer";
import type { ScheduleDayStop } from "./types";

export type RoomTransferSourceIssue =
  | "missing-room-code"
  | "not-found"
  | "identity-mismatch"
  | "conflicting-room-code";

export type RoomTransferSourceResolution = {
  roomsById: Map<number, RoomTransferEndpoint>;
  issuesByRoomId: Map<number, RoomTransferSourceIssue>;
};

type TransferRoomRecord = Pick<RoomData, "id" | "code" | "buildingId">;

export type RoomTransferSourceDependencies = {
  getLocalById: (id: number) => Promise<TransferRoomRecord | null>;
  getRemoteByCode: (code: string) => Promise<TransferRoomRecord | null>;
};

function normalizeRoomCode(code: string | null): string | null {
  const normalized = code?.trim().toUpperCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function defaultRemoteRoomByCode(
  code: string,
): Promise<TransferRoomRecord | null> {
  try {
    const payload = await getJSONFetch<{ data?: RoomData | null }>(
      `/api/rooms?code=${encodeURIComponent(code)}`,
    );
    const room = payload?.data;
    return room
      ? { id: room.id, code: room.code, buildingId: room.buildingId }
      : null;
  } catch {
    return null;
  }
}

const defaultDependencies: RoomTransferSourceDependencies = {
  getLocalById: async (id) => {
    const room = await getLocalRoomById(id);
    return room
      ? { id: room.id, code: room.code, buildingId: room.buildingId }
      : null;
  },
  getRemoteByCode: defaultRemoteRoomByCode,
};

export async function resolveRoomTransferEndpoint(
  roomId: number,
  roomCode: string | null,
  dependencies: RoomTransferSourceDependencies = defaultDependencies,
): Promise<{
  room: RoomTransferEndpoint | null;
  issue: RoomTransferSourceIssue | null;
}> {
  const local = await dependencies.getLocalById(roomId);
  if (local) {
    if (local.id !== roomId) {
      return { room: null, issue: "identity-mismatch" };
    }
    return {
      room: {
        id: local.id,
        code: local.code,
        buildingId: local.buildingId,
      },
      issue: null,
    };
  }

  const normalizedCode = normalizeRoomCode(roomCode);
  if (!normalizedCode) {
    return { room: null, issue: "missing-room-code" };
  }

  const remote = await dependencies.getRemoteByCode(normalizedCode);
  if (!remote) return { room: null, issue: "not-found" };
  if (remote.id !== roomId) {
    return { room: null, issue: "identity-mismatch" };
  }
  return {
    room: {
      id: remote.id,
      code: remote.code,
      buildingId: remote.buildingId,
    },
    issue: null,
  };
}

/**
 * Resolve unique rooms needed by one ordered day of classes.
 *
 * Repeated classes in the same room perform one lookup. If one room id appears
 * with conflicting room codes, the id is deliberately left unresolved rather
 * than picking one code arbitrarily for the remote fallback.
 */
export async function resolveTransferRoomsForStops(
  stops: readonly ScheduleDayStop[],
  dependencies: RoomTransferSourceDependencies = defaultDependencies,
): Promise<RoomTransferSourceResolution> {
  const codeByRoomId = new Map<number, string | null>();
  const conflicts = new Set<number>();

  for (const stop of stops) {
    if (stop.roomId === null) continue;
    const code = normalizeRoomCode(stop.roomCode);
    if (!codeByRoomId.has(stop.roomId)) {
      codeByRoomId.set(stop.roomId, code);
      continue;
    }
    const existing = codeByRoomId.get(stop.roomId) ?? null;
    if (existing !== null && code !== null && existing !== code) {
      conflicts.add(stop.roomId);
    } else if (existing === null && code !== null) {
      codeByRoomId.set(stop.roomId, code);
    }
  }

  const roomsById = new Map<number, RoomTransferEndpoint>();
  const issuesByRoomId = new Map<number, RoomTransferSourceIssue>();
  for (const roomId of conflicts) {
    issuesByRoomId.set(roomId, "conflicting-room-code");
  }

  await Promise.all(
    [...codeByRoomId.entries()]
      .filter(([roomId]) => !conflicts.has(roomId))
      .map(async ([roomId, roomCode]) => {
        const resolved = await resolveRoomTransferEndpoint(
          roomId,
          roomCode,
          dependencies,
        );
        if (resolved.room) roomsById.set(roomId, resolved.room);
        else if (resolved.issue) issuesByRoomId.set(roomId, resolved.issue);
      }),
  );

  return { roomsById, issuesByRoomId };
}
