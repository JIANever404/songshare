import type { SubjectKind } from "@/lib/subject-kind";
import type { ShareSubject, SubjectSearchResponse } from "@/lib/share/types";
import { resolveItunesStorefrontForQuery, type ItunesStorefront } from "@/lib/itunes/storefront";
import { normalizeItunesDisplayText } from "@/lib/itunes/text";

const ITUNES_API_BASE_URL = "https://itunes.apple.com";
const ITUNES_RETRY_MAX_ATTEMPTS = 3;
const ITUNES_RETRY_BASE_DELAY_MS = 300;
const ITUNES_RETRY_MAX_DELAY_MS = 10 * 1000;
const ITUNES_RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

type ItunesTrackResult = {
  wrapperType: string;
  trackId?: number;
  collectionId?: number;
  artistName: string;
  trackName: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  collectionViewUrl?: string;
  trackViewUrl?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
};

export type ItunesSongPreviewCandidate = {
  id: number | string;
  title: string;
  artist: string;
  cover: string | null;
  previewUrl: string | null;
  appleUrl: string | null;
  releaseYear?: number;
  durationMs?: number;
};

class ItunesHttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`iTunes search failed: ${status}`);
    this.name = "ItunesHttpError";
    this.status = status;
  }
}

function extractYear(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  if (!Number.isFinite(year) || year < 1970 || year > 2100) {
    return undefined;
  }
  return year;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function enhanceArtworkUrl(url?: string | null): string | null {
  if (!url) return null;
  return url.replace("100x100bb", "1000x1000bb");
}

function resolveSongSubjectId(result: ItunesTrackResult): number | null {
  if (typeof result.trackId === "number" && Number.isFinite(result.trackId)) {
    return result.trackId;
  }
  if (typeof result.collectionId === "number" && Number.isFinite(result.collectionId)) {
    return result.collectionId;
  }
  return null;
}

function toShareSongSubject(
  result: ItunesTrackResult,
  storefront: ItunesStorefront
): ShareSubject | null {
  const id = resolveSongSubjectId(result);
  if (id === null) {
    return null;
  }

  const cover = enhanceArtworkUrl(result.artworkUrl100);
  const releaseYear = extractYear(result.releaseDate);
  const genres = result.primaryGenreName ? [result.primaryGenreName] : [];
  const artistName = normalizeItunesDisplayText(result.artistName, storefront);
  const trackName = normalizeItunesDisplayText(result.trackName, storefront);

  return {
    id,
    name: artistName || result.artistName,
    localizedName: trackName || result.trackName,
    cover,
    releaseYear,
    genres,
    storeUrls: {
      apple: result.trackViewUrl || result.collectionViewUrl || "",
    },
  };
}

function toSongPreviewCandidate(
  result: ItunesTrackResult,
  storefront: ItunesStorefront
): ItunesSongPreviewCandidate | null {
  const id = resolveSongSubjectId(result);
  if (id === null) {
    return null;
  }

  const artistName = normalizeItunesDisplayText(result.artistName, storefront);
  const trackName = normalizeItunesDisplayText(result.trackName, storefront);

  return {
    id,
    title: trackName || result.trackName,
    artist: artistName || result.artistName,
    cover: enhanceArtworkUrl(result.artworkUrl100),
    previewUrl: result.previewUrl || null,
    appleUrl: result.trackViewUrl || result.collectionViewUrl || null,
    releaseYear: extractYear(result.releaseDate),
    durationMs:
      typeof result.trackTimeMillis === "number" && Number.isFinite(result.trackTimeMillis)
        ? result.trackTimeMillis
        : undefined,
  };
}

function isRetryableStatus(status: number): boolean {
  return ITUNES_RETRYABLE_STATUS.has(status);
}

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name !== "AbortError";
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return seconds * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) {
    return null;
  }
  return Math.max(0, dateMs - Date.now());
}

function computeRetryDelayMs(params: {
  attempt: number;
  retryAfterMs?: number | null;
}): number {
  const { attempt, retryAfterMs } = params;
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)) {
    return Math.min(Math.max(0, Math.trunc(retryAfterMs)), ITUNES_RETRY_MAX_DELAY_MS);
  }
  const exponentialDelay = Math.min(
    ITUNES_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    ITUNES_RETRY_MAX_DELAY_MS
  );
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(exponentialDelay + jitter, ITUNES_RETRY_MAX_DELAY_MS);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchItunesSearch<T>(term: string, country: ItunesStorefront, limit: number): Promise<T[]> {
  const url = new URL(`${ITUNES_API_BASE_URL}/search`);
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "musicTrack");
  url.searchParams.set("country", country);
  url.searchParams.set("limit", String(limit));

  const requestInit = {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  } as RequestInit & { next?: { revalidate?: number } };

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ITUNES_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url.toString(), requestInit);
      if (response.ok) {
        const json = (await response.json()) as { results?: T[] };
        return Array.isArray(json?.results) ? json.results : [];
      }

      const canRetry =
        attempt < ITUNES_RETRY_MAX_ATTEMPTS && isRetryableStatus(response.status);
      if (!canRetry) {
        throw new ItunesHttpError(response.status);
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      await sleep(computeRetryDelayMs({ attempt, retryAfterMs }));
    } catch (error) {
      lastError = error;
      if (error instanceof ItunesHttpError) {
        throw error;
      }
      const canRetry =
        attempt < ITUNES_RETRY_MAX_ATTEMPTS && isRetryableFetchError(error);
      if (!canRetry) {
        throw error;
      }
      await sleep(computeRetryDelayMs({ attempt }));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("iTunes search failed");
}

function scoreCandidate(query: string, subject: ShareSubject): number {
  const q = normalizeText(query);
  if (!q) return 0;

  const candidates = [subject.localizedName || "", subject.name];
  let score = 0;

  for (const text of candidates) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    if (normalized === q) score += 100;
    if (normalized.startsWith(q)) score += 60;
    if (normalized.includes(q)) score += 25;
  }

  if (typeof subject.releaseYear === "number") {
    const yearText = String(subject.releaseYear);
    if (yearText.includes(q)) score += 5;
  }

  return score;
}

function reorderByPromotedIds<T extends { id: number | string }>(
  items: T[],
  promotedIds: Array<number | string>
): T[] {
  if (items.length === 0 || promotedIds.length === 0) {
    return items;
  }

  const promotedSet = new Set(promotedIds.map((id) => String(id)));
  const promoted: T[] = [];
  const rest: T[] = [];

  for (const item of items) {
    if (promotedSet.has(String(item.id))) {
      promoted.push(item);
    } else {
      rest.push(item);
    }
  }

  return [...promoted, ...rest];
}

export function buildItunesSearchResponse(params: {
  query: string;
  kind: SubjectKind;
  items: ShareSubject[];
}): SubjectSearchResponse {
  const { query, kind, items } = params;

  const ranked = items
    .map((item) => ({
      id: item.id,
      score: scoreCandidate(query, item),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.id);

  const promotedIds =
    ranked.length > 0 ? ranked : items.slice(0, 2).map((item) => item.id);
  const orderedItems = reorderByPromotedIds(items, promotedIds);

  return {
    ok: true,
    source: "itunes",
    kind,
    items: orderedItems,
    noResultQuery: items.length === 0 && query.trim() ? query : null,
  };
}

export async function searchItunesSong(params: {
  query: string;
  kind: SubjectKind;
}): Promise<ShareSubject[]> {
  const q = params.query.trim();
  if (!q) return [];
  const storefront = resolveItunesStorefrontForQuery(q);

  const results = await fetchItunesSearch<ItunesTrackResult>(q, storefront, 20);
  return results
    .filter((result) => result.wrapperType === "track")
    .map((result) => toShareSongSubject(result, storefront))
    .filter((item): item is ShareSubject => item !== null);
}

export async function searchItunesSongPreviewCandidates(params: {
  query: string;
}): Promise<ItunesSongPreviewCandidate[]> {
  const q = params.query.trim();
  if (!q) return [];
  const storefront = resolveItunesStorefrontForQuery(q);

  const results = await fetchItunesSearch<ItunesTrackResult>(q, storefront, 12);
  return results
    .filter((result) => result.wrapperType === "track")
    .map((result) => toSongPreviewCandidate(result, storefront))
    .filter((item): item is ItunesSongPreviewCandidate => item !== null);
}
