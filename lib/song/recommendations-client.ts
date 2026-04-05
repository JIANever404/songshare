"use client";

import snapshotMeta from "@/lib/generated/song-recommendations.snapshot-meta.json";
import type { RecommendedShareGame, SongRecommendationResponse } from "@/lib/share/types";
import type { SubjectKind } from "@/lib/subject-kind";

const SONG_RECOMMENDATION_SNAPSHOT_VERSION =
  typeof snapshotMeta?.version === "string" && snapshotMeta.version.trim()
    ? snapshotMeta.version
    : "static";
const SONG_RECOMMENDATION_CLIENT_CACHE_KEY_PREFIX = `songshare-song-recommendations:${SONG_RECOMMENDATION_SNAPSHOT_VERSION}`;
const SONG_RECOMMENDATION_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;

type RecommendationClientCacheEntry = {
  expiresAt: number;
  response: SongRecommendationResponse;
};

function getSongRecommendationClientCacheKey(kind: SubjectKind) {
  return `${SONG_RECOMMENDATION_CLIENT_CACHE_KEY_PREFIX}:${kind}`;
}

function shuffleItems<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function normalizeArtistKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function takeNextCandidate(
  pool: RecommendedShareGame[],
  previousArtistKey: string,
  previousWasHot: boolean
) {
  if (pool.length === 0) return null;

  let nextIndex = pool.findIndex((item) => {
    const artistKey = normalizeArtistKey(item.name);
    return artistKey !== previousArtistKey && !(previousWasHot && item.isHot);
  });

  if (nextIndex < 0) {
    nextIndex = pool.findIndex((item) => normalizeArtistKey(item.name) !== previousArtistKey);
  }

  if (nextIndex < 0) {
    nextIndex = pool.findIndex((item) => !(previousWasHot && item.isHot));
  }

  if (nextIndex < 0) {
    nextIndex = 0;
  }

  const [nextItem] = pool.splice(nextIndex, 1);
  return nextItem ?? null;
}

function repairRecommendationClusters(items: RecommendedShareGame[]) {
  const next = [...items];

  for (let index = 1; index < next.length; index += 1) {
    const previous = next[index - 1];
    const current = next[index];
    if (!previous || !current) continue;

    const sameArtist =
      normalizeArtistKey(previous.name) === normalizeArtistKey(current.name);
    const hotCluster = previous.isHot && current.isHot;

    if (!sameArtist && !hotCluster) continue;

    const swapIndex = next.findIndex((candidate, candidateIndex) => {
      if (candidateIndex <= index) return false;
      const prevArtist = normalizeArtistKey(previous.name);
      const candidateArtist = normalizeArtistKey(candidate.name);
      if (candidateArtist === prevArtist) return false;
      if (previous.isHot && candidate.isHot) return false;

      const nextNeighbor = next[index + 1];
      if (nextNeighbor) {
        const neighborArtist = normalizeArtistKey(nextNeighbor.name);
        if (candidateArtist === neighborArtist) return false;
        if (candidate.isHot && nextNeighbor.isHot) return false;
      }

      return true;
    });

    if (swapIndex > index) {
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    }
  }

  return next;
}

export function arrangeRecommendationItems(items: RecommendedShareGame[]) {
  const hotItems = shuffleItems(items.filter((item) => item.isHot));
  const normalItems = shuffleItems(items.filter((item) => !item.isHot));
  const arranged: RecommendedShareGame[] = [];

  let previousArtistKey = "";
  let previousWasHot = false;
  let normalSinceHot = 0;

  while (hotItems.length > 0 || normalItems.length > 0) {
    const shouldUseHot =
      hotItems.length > 0 &&
      (normalItems.length === 0 || normalSinceHot >= 2);
    const currentPool =
      shouldUseHot || normalItems.length === 0 ? hotItems : normalItems;

    const nextItem = takeNextCandidate(currentPool, previousArtistKey, previousWasHot);
    if (!nextItem) break;

    arranged.push(nextItem);
    previousArtistKey = normalizeArtistKey(nextItem.name);
    previousWasHot = nextItem.isHot;
    normalSinceHot = nextItem.isHot ? 0 : normalSinceHot + 1;
  }

  return repairRecommendationClusters(arranged);
}

function readRecommendationCacheEntry(kind: SubjectKind): RecommendationClientCacheEntry | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(getSongRecommendationClientCacheKey(kind));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<RecommendationClientCacheEntry>;
    if (!parsed || typeof parsed.expiresAt !== "number" || !parsed.response) {
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(getSongRecommendationClientCacheKey(kind));
      return null;
    }

    const response = parsed.response as SongRecommendationResponse;
    if (!response.ok || !Array.isArray(response.items)) {
      return null;
    }

    return {
      expiresAt: parsed.expiresAt,
      response,
    };
  } catch {
    return null;
  }
}

function writeRecommendationCacheEntry(
  kind: SubjectKind,
  response: SongRecommendationResponse
) {
  if (typeof window === "undefined") return response;

  const arrangedResponse: SongRecommendationResponse = {
    ...response,
    items: arrangeRecommendationItems(response.items),
  };

  const entry: RecommendationClientCacheEntry = {
    expiresAt: Date.now() + SONG_RECOMMENDATION_CLIENT_CACHE_TTL_MS,
    response: arrangedResponse,
  };

  try {
    window.sessionStorage.setItem(
      getSongRecommendationClientCacheKey(kind),
      JSON.stringify(entry)
    );
  } catch {
    // ignore write failures
  }

  return arrangedResponse;
}

export function readSongRecommendationClientCache(kind: SubjectKind) {
  if (kind !== "song") return null;
  return readRecommendationCacheEntry(kind)?.response ?? null;
}

export async function primeSongRecommendationClientCache(
  kind: SubjectKind,
  options?: { force?: boolean }
) {
  if (kind !== "song") return null;
  const force = options?.force === true;
  if (!force) {
    const cached = readRecommendationCacheEntry(kind);
    if (cached) return cached.response;
  }

  const response = await fetch(`/api/song/recommendations?kind=${encodeURIComponent(kind)}`);
  const json = (await response.json()) as Partial<SongRecommendationResponse> & {
    ok?: boolean;
  };

  if (!response.ok || !json?.ok || !Array.isArray(json.items)) {
    return null;
  }

  return writeRecommendationCacheEntry(kind, {
    ok: true,
    source: "apple-charts",
    kind,
    items: json.items as RecommendedShareGame[],
  });
}
