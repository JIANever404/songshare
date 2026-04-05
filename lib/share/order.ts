import type { ShareGame } from "@/lib/share/types";

function sanitizeEntryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getShareGameEntryIds(games: Array<ShareGame | null>): string[] {
  const entryIds: string[] = [];
  const seen = new Set<string>();

  for (const game of games) {
    const entryId = sanitizeEntryId(game?.entryId);
    if (!entryId || seen.has(entryId)) {
      continue;
    }
    seen.add(entryId);
    entryIds.push(entryId);
  }

  return entryIds;
}

export function normalizeCoverOrder(
  entryIds: readonly string[],
  requested?: readonly string[] | null
): string[] {
  const available = new Set(entryIds);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const rawEntryId of requested ?? []) {
    const entryId = sanitizeEntryId(rawEntryId);
    if (!entryId || !available.has(entryId) || seen.has(entryId)) {
      continue;
    }
    seen.add(entryId);
    ordered.push(entryId);
  }

  for (const entryId of entryIds) {
    if (seen.has(entryId)) continue;
    seen.add(entryId);
    ordered.push(entryId);
  }

  return ordered;
}

export function hasCustomCoverOrder(
  entryIds: readonly string[],
  coverOrder: readonly string[]
): boolean {
  if (entryIds.length !== coverOrder.length) {
    return false;
  }

  return entryIds.some((entryId, index) => coverOrder[index] !== entryId);
}

export function toCoverOrderSlotIndices(
  entryIds: readonly string[],
  coverOrder: readonly string[]
): number[] {
  const positions = new Map<string, number>();
  entryIds.forEach((entryId, index) => {
    positions.set(entryId, index);
  });

  return coverOrder
    .map((entryId) => positions.get(entryId))
    .filter((index): index is number => typeof index === "number");
}
