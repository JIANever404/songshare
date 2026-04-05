import type { SubjectSnapshot } from "@/lib/share/compact";
import { buildStoredShareEntryId, normalizeShareEntryId } from "@/lib/share/entry-id";
import { getShareGameEntryIds, normalizeCoverOrder } from "@/lib/share/order";
import type { ShareSubject, StoredShareV1 } from "@/lib/share/types";
import { DEFAULT_SUBJECT_KIND, type SubjectKind, parseSubjectKind } from "@/lib/subject-kind";

export const SHARES_V2_TABLE = "songshare_share_registry_v2";
export const SUBJECT_DIM_TABLE = "songshare_subject_dim_v1";
export const SITE_VISITORS_TABLE = "songshare_site_visitors_v1";
export const MAX_BATCH_SIZE = 96;

export type ShareRegistryRow = {
  share_id: string;
  kind: string;
  creator_name: string | null;
  hot_payload: unknown;
  created_at: number | string;
  updated_at: number | string;
  last_viewed_at: number | string;
};

export type SubjectDimRow = {
  subject_id: string;
  name: string;
  localized_name: string | null;
  cover: string | null;
  release_year: number | string | null;
  genres: unknown;
};

export function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

export function normalizeStoredShare(input: StoredShareV1): StoredShareV1 {
  const creatorName =
    typeof input.creatorName === "string" && input.creatorName.trim()
      ? input.creatorName.trim()
      : null;
  const shareMessage =
    typeof input.shareMessage === "string" && input.shareMessage.trim()
      ? input.shareMessage.trim()
      : null;
  const games = input.games.map((game, index) => {
    if (!game) return null;

    const entryId =
      normalizeShareEntryId(game.entryId) ??
      buildStoredShareEntryId({
        shareId: input.shareId,
        slotIndex: index,
        subjectId: game.id,
      });

    return {
      ...game,
      entryId,
    };
  });
  const coverOrder = normalizeCoverOrder(
    getShareGameEntryIds(games),
    Array.isArray(input.coverOrder) ? input.coverOrder : null
  );

  return {
    ...input,
    kind: parseSubjectKind(input.kind) ?? DEFAULT_SUBJECT_KIND,
    creatorName,
    shareMessage,
    games,
    coverOrder,
  };
}

export function parseJsonValue<T>(value: unknown): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return value as T;
  }
  return null;
}

export function parseStringArray(value: unknown): string[] {
  const parsed = parseJsonValue<unknown>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => Boolean(item));
}

export function collectSubjectIdsFromPayload(
  payload: Array<{
    sid: string;
  } | null>
): string[] {
  const subjectIds = new Set<string>();
  for (const slot of payload) {
    if (slot?.sid) {
      subjectIds.add(slot.sid);
    }
  }
  return Array.from(subjectIds);
}

export function toSubjectSnapshot(row: SubjectDimRow): SubjectSnapshot {
  const releaseYear = toNumber(row.release_year, NaN);
  const genres = parseStringArray(row.genres);

  return {
    subjectId: row.subject_id,
    name: row.name,
    localizedName: row.localized_name ?? undefined,
    cover: row.cover ?? null,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : undefined,
    genres: genres.length > 0 ? genres : undefined,
  };
}

export function chunkArray<T>(items: T[], size = MAX_BATCH_SIZE): T[][] {
  if (size <= 0) {
    return [items.slice()];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function throwStorageError(message: string, error: unknown): never {
  if (error instanceof Error) {
    throw new Error(`${message}: ${error.message}`, { cause: error });
  }
  throw new Error(`${message}: ${String(error)}`);
}

export function assertSubjectKind(kind: SubjectKind): SubjectKind {
  return kind;
}

export function assertShareSubject(subject: ShareSubject): ShareSubject {
  return subject;
}
