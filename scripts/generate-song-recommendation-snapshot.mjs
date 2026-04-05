#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Converter } from "opencc-js";

const traditionalToSimplified = Converter({ from: "hk", to: "cn" });

const APPLE_CHART_API_BASE = "https://rss.marketingtools.apple.com/api/v2";
const ITUNES_SEARCH_API_BASE = "https://itunes.apple.com/search";
const CHART_RETRY_MAX_ATTEMPTS = 3;
const CHART_RETRY_BASE_DELAY_MS = 300;
const CHART_RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const CHART_MAX_PER_ARTIST = 3;
const CHART_MAX_REFILL_ROUNDS = 3;
const CHART_MAX_FETCH_LIMIT = 100;
const ARTIST_SEARCH_LIMIT = 50;

const CHART_SOURCES = [
  { storefront: "cn", quota: 60, fetchLimit: 60 },
  { storefront: "tw", quota: 10, fetchLimit: 10 },
  { storefront: "hk", quota: 10, fetchLimit: 10 },
  { storefront: "us", quota: 5, fetchLimit: 5 },
  { storefront: "jp", quota: 5, fetchLimit: 5 },
];

const CHART_HOT_LIMITS = {
  cn: 20,
  tw: 3,
  hk: 3,
  us: 2,
  jp: 2,
};

const GLOBAL_ARTIST_COUNT_LIMITS = {
  "防弹少年团": 3,
  BTS: 3,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.resolve(__dirname, "../lib/generated");
const SNAPSHOT_PATH = path.join(GENERATED_DIR, "song-recommendations.snapshot.json");
const SNAPSHOT_META_PATH = path.join(GENERATED_DIR, "song-recommendations.snapshot-meta.json");
const artistSupplementCache = new Map();

function normalizeChartStorefrontForText(storefront) {
  if (storefront === "jp") return "jp";
  if (storefront === "us") return "us";
  return "cn";
}

function normalizeItunesDisplayText(value, storefront) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (storefront === "cn") {
    return traditionalToSimplified(trimmed);
  }

  return trimmed;
}

function extractYear(raw) {
  if (!raw) return undefined;
  const year = Number.parseInt(String(raw).slice(0, 4), 10);
  if (!Number.isFinite(year) || year < 1970 || year > 2100) {
    return undefined;
  }
  return year;
}

function enhanceArtworkUrl(url) {
  if (!url) return null;
  return String(url).replace(/\/\d+x\d+bb(\.[a-z]+)$/i, "/1000x1000bb$1");
}

function isRetryableStatus(status) {
  return CHART_RETRYABLE_STATUS.has(status);
}

function computeRetryDelayMs(attempt) {
  return Math.min(CHART_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), 4000);
}

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAppleChartFeed(storefront, fetchLimit) {
  const url = `${APPLE_CHART_API_BASE}/${storefront}/music/most-played/${fetchLimit}/songs.json`;

  let lastError = null;
  for (let attempt = 1; attempt <= CHART_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const json = await response.json();
        return Array.isArray(json?.feed?.results) ? json.feed.results : [];
      }

      if (attempt >= CHART_RETRY_MAX_ATTEMPTS || !isRetryableStatus(response.status)) {
        throw new Error(`Apple chart request failed: ${response.status} ${storefront}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt >= CHART_RETRY_MAX_ATTEMPTS) {
        throw error;
      }
    }

    await sleep(computeRetryDelayMs(attempt));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Apple chart request failed");
}

function toChartCandidate(storefront, storefrontRank, item) {
  const songName = normalizeItunesDisplayText(
    item?.name,
    normalizeChartStorefrontForText(storefront)
  );
  const artistName = normalizeItunesDisplayText(
    item?.artistName,
    normalizeChartStorefrontForText(storefront)
  );
  const id =
    typeof item?.id === "string" && item.id.trim() ? item.id.trim() : null;

  if (!songName || !artistName || !id) {
    return null;
  }

  return {
    storefront,
    storefrontRank,
    game: {
      id,
      name: artistName,
      localizedName: songName,
      cover: enhanceArtworkUrl(item?.artworkUrl100),
      releaseYear: extractYear(item?.releaseDate),
      genres: Array.isArray(item?.genres)
        ? item.genres
            .map((genre) => (typeof genre?.name === "string" ? genre.name.trim() : ""))
            .filter(Boolean)
        : undefined,
      storeUrls: item?.url
        ? {
            apple: item.url,
          }
        : undefined,
    },
  };
}

function toSearchCandidate(storefront, item) {
  const songName = normalizeItunesDisplayText(
    item?.trackName,
    normalizeChartStorefrontForText(storefront)
  );
  const artistName = normalizeItunesDisplayText(
    item?.artistName,
    normalizeChartStorefrontForText(storefront)
  );
  const id =
    typeof item?.trackId === "number" || typeof item?.trackId === "string"
      ? String(item.trackId).trim()
      : null;

  if (!songName || !artistName || !id) {
    return null;
  }

  const primaryGenre =
    typeof item?.primaryGenreName === "string" && item.primaryGenreName.trim()
      ? [item.primaryGenreName.trim()]
      : undefined;

  return {
    storefront,
    storefrontRank: Number.POSITIVE_INFINITY,
    game: {
      id,
      name: artistName,
      localizedName: songName,
      cover: enhanceArtworkUrl(item?.artworkUrl100 || item?.artworkUrl60),
      releaseYear: extractYear(item?.releaseDate),
      genres: primaryGenre,
      storeUrls: item?.trackViewUrl
        ? {
            apple: item.trackViewUrl,
          }
        : undefined,
    },
  };
}

function normalizeKeyText(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return traditionalToSimplified(trimmed).toLowerCase();
}

function normalizeArtistKey(value) {
  return normalizeKeyText(value);
}

function normalizeSongTitleForDedup(value) {
  let normalized = normalizeKeyText(value);
  if (!normalized) {
    return "";
  }

  const dedupDecoratorPattern =
    /\s*[\(\（][^()\（\）]*?(主题曲|片尾曲|插曲|推广曲|宣传曲|影视剧|剧集|电影|ost|原声带)[^()\（\）]*?[\)\）]\s*$/i;

  while (dedupDecoratorPattern.test(normalized)) {
    normalized = normalized.replace(dedupDecoratorPattern, "").trim();
  }

  return normalized;
}

function getGlobalArtistCountLimit(artistName) {
  const artistKey = normalizeArtistKey(artistName);
  if (!artistKey) {
    return Number.POSITIVE_INFINITY;
  }

  for (const [rawArtistName, limit] of Object.entries(GLOBAL_ARTIST_COUNT_LIMITS)) {
    if (normalizeArtistKey(rawArtistName) === artistKey) {
      return limit;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function incrementArtistCount(artistCounts, artistName) {
  const artistKey = normalizeArtistKey(artistName);
  if (!artistKey) {
    return;
  }

  artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
}

function cloneArtistCounts(sourceArtistCounts) {
  return new Map(sourceArtistCounts.entries());
}

function normalizeSongKey(game) {
  const artist = normalizeArtistKey(game?.name);
  const song = normalizeSongTitleForDedup(game?.localizedName);
  if (artist || song) {
    return `${artist}::${song}`;
  }

  const id =
    typeof game?.id === "string" || typeof game?.id === "number" ? String(game.id).trim() : "";
  if (!id) {
    return "";
  }

  return `apple:${id}`;
}

function limitCandidatesPerArtist(items, limit) {
  const artistCounts = new Map();
  const filtered = [];

  for (const item of items) {
    const artistKey = normalizeArtistKey(item.game.name);
    const nextArtistCount = (artistCounts.get(artistKey) || 0) + 1;
    if (nextArtistCount > CHART_MAX_PER_ARTIST) {
      continue;
    }

    artistCounts.set(artistKey, nextArtistCount);
    filtered.push(item);

    if (filtered.length >= limit) {
      break;
    }
  }

  return filtered;
}

function selectUniqueSongs(items, seenSongKeys, globalArtistCounts, limit) {
  const selected = [];
  const localSeenSongKeys = new Set();
  const localArtistCounts = cloneArtistCounts(globalArtistCounts);

  for (const item of items) {
    const songKey = normalizeSongKey(item.game);
    if (seenSongKeys.has(songKey) || localSeenSongKeys.has(songKey)) {
      continue;
    }

    const artistKey = normalizeArtistKey(item.game.name);
    const globalArtistLimit = getGlobalArtistCountLimit(item.game.name);
    if (artistKey && (localArtistCounts.get(artistKey) || 0) >= globalArtistLimit) {
      continue;
    }

    localSeenSongKeys.add(songKey);
    incrementArtistCount(localArtistCounts, item.game.name);
    selected.push(item);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

async function fetchArtistSupplementCandidates(storefront, artistName) {
  const artistKey = normalizeArtistKey(artistName);
  const cacheKey = `${storefront}::${artistKey}`;
  const cached = artistSupplementCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const url = new URL(ITUNES_SEARCH_API_BASE);
    url.searchParams.set("term", artistName);
    url.searchParams.set("entity", "song");
    url.searchParams.set("attribute", "artistTerm");
    url.searchParams.set("limit", String(ARTIST_SEARCH_LIMIT));
    url.searchParams.set("country", storefront);

    let lastError = null;
    for (let attempt = 1; attempt <= CHART_RETRY_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
          },
        });

        if (response.ok) {
          const json = await response.json();
          const candidates = Array.isArray(json?.results)
            ? json.results.map((item) => toSearchCandidate(storefront, item)).filter(Boolean)
            : [];
          const exactMatches = candidates.filter(
            (candidate) => normalizeArtistKey(candidate.game.name) === artistKey
          );

          if (exactMatches.length > 0) {
            return exactMatches;
          }

          return candidates.filter((candidate) => {
            const candidateArtistKey = normalizeArtistKey(candidate.game.name);
            return candidateArtistKey.includes(artistKey) || artistKey.includes(candidateArtistKey);
          });
        }

        if (attempt >= CHART_RETRY_MAX_ATTEMPTS || !isRetryableStatus(response.status)) {
          throw new Error(`Artist song search failed: ${response.status} ${storefront} ${artistName}`);
        }
      } catch (error) {
        lastError = error;
        if (attempt >= CHART_RETRY_MAX_ATTEMPTS) {
          throw error;
        }
      }

      await sleep(computeRetryDelayMs(attempt));
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error(`Artist song search failed: ${storefront} ${artistName}`);
  })();

  artistSupplementCache.set(cacheKey, pending);
  return pending;
}

async function supplementStorefrontCandidates(
  source,
  selected,
  seenSongKeys,
  chartSongKeys,
  globalArtistCounts
) {
  if (selected.length >= source.quota) {
    return selected.slice(0, source.quota);
  }

  const supplemented = [...selected];
  const localSeenSongKeys = new Set(
    selected.map((item) => normalizeSongKey(item.game)).filter(Boolean)
  );
  const localArtistCounts = cloneArtistCounts(globalArtistCounts);
  for (const item of selected) {
    incrementArtistCount(localArtistCounts, item.game.name);
  }
  const artistOrder = [];
  const seenArtists = new Set();

  for (const item of selected) {
    const artistKey = normalizeArtistKey(item.game.name);
    if (!artistKey || seenArtists.has(artistKey)) {
      continue;
    }

    seenArtists.add(artistKey);
    artistOrder.push({
      artistKey,
      artistName: item.game.name,
    });
  }

  if (artistOrder.length === 0) {
    return supplemented;
  }

  const artistCandidateResults = await Promise.allSettled(
    artistOrder.map(async ({ artistKey, artistName }) => {
      const candidates = await fetchArtistSupplementCandidates(source.storefront, artistName);
      return [artistKey, candidates];
    })
  );
  const artistCandidatesByKey = new Map();
  for (const result of artistCandidateResults) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const [artistKey, candidates] = result.value;
    artistCandidatesByKey.set(artistKey, candidates);
  }
  const artistCursorByKey = new Map(artistOrder.map(({ artistKey }) => [artistKey, 0]));

  while (supplemented.length < source.quota) {
    let addedInRound = 0;

    for (const { artistKey } of artistOrder) {
      const candidates = artistCandidatesByKey.get(artistKey) || [];
      let cursor = artistCursorByKey.get(artistKey) || 0;

      while (cursor < candidates.length) {
        const candidate = candidates[cursor];
        cursor += 1;

        const songKey = normalizeSongKey(candidate.game);
        if (!songKey) {
          continue;
        }

        if (chartSongKeys.has(songKey) || seenSongKeys.has(songKey) || localSeenSongKeys.has(songKey)) {
          continue;
        }

        const globalArtistLimit = getGlobalArtistCountLimit(candidate.game.name);
        if ((localArtistCounts.get(artistKey) || 0) >= globalArtistLimit) {
          continue;
        }

        localSeenSongKeys.add(songKey);
        incrementArtistCount(localArtistCounts, candidate.game.name);
        supplemented.push(candidate);
        addedInRound += 1;
        break;
      }

      artistCursorByKey.set(artistKey, cursor);

      if (supplemented.length >= source.quota) {
        break;
      }
    }

    if (addedInRound === 0) {
      break;
    }
  }

  return supplemented;
}

async function fetchStorefrontCandidates(source, seenSongKeys, globalArtistCounts) {
  let currentFetchLimit = Math.min(source.fetchLimit, CHART_MAX_FETCH_LIMIT);
  let selected = [];
  const chartSongKeys = new Set();

  for (let round = 1; round <= CHART_MAX_REFILL_ROUNDS; round += 1) {
    const items = await fetchAppleChartFeed(source.storefront, currentFetchLimit);
    const candidates = items
      .map((item, index) => toChartCandidate(source.storefront, index + 1, item))
      .filter(Boolean);
    for (const candidate of candidates) {
      const songKey = normalizeSongKey(candidate.game);
      if (songKey) {
        chartSongKeys.add(songKey);
      }
    }

    const filtered = limitCandidatesPerArtist(candidates, currentFetchLimit);
    selected = selectUniqueSongs(filtered, seenSongKeys, globalArtistCounts, source.quota);

    if (selected.length >= source.quota) {
      return selected.slice(0, source.quota);
    }

    const deficit = source.quota - selected.length;
    const nextFetchLimit = Math.min(currentFetchLimit + deficit, CHART_MAX_FETCH_LIMIT);
    if (nextFetchLimit <= currentFetchLimit) {
      break;
    }
    currentFetchLimit = nextFetchLimit;
  }

  try {
    return await supplementStorefrontCandidates(
      source,
      selected,
      seenSongKeys,
      chartSongKeys,
      globalArtistCounts
    );
  } catch {
    return selected.slice(0, source.quota);
  }
}

function mergeChartCandidates(candidatesByStorefront) {
  const merged = [];

  for (const source of CHART_SOURCES) {
    const items = candidatesByStorefront.get(source.storefront) || [];
    merged.push(...items.slice(0, source.quota));
  }

  return merged;
}

async function generateSnapshot() {
  const candidatesByStorefront = new Map();
  const seenSongKeys = new Set();
  const globalArtistCounts = new Map();
  const failures = [];

  for (const source of CHART_SOURCES) {
    try {
      const items = await fetchStorefrontCandidates(source, seenSongKeys, globalArtistCounts);
      candidatesByStorefront.set(source.storefront, items);

      for (const item of items) {
        seenSongKeys.add(normalizeSongKey(item.game));
        incrementArtistCount(globalArtistCounts, item.game.name);
      }
    } catch (error) {
      failures.push(error);
    }
  }

  const merged = mergeChartCandidates(candidatesByStorefront);
  if (merged.length === 0) {
    const firstFailure = failures[0];
    throw firstFailure instanceof Error
      ? firstFailure
      : new Error("No recommendation snapshot items generated");
  }

  const items = merged.map((item, index) => ({
    ...item.game,
    chartStorefront: item.storefront,
    chartRank: index + 1,
    isHot: item.storefrontRank <= CHART_HOT_LIMITS[item.storefront],
  }));

  const generatedAt = new Date().toISOString();
  const version = String(Date.now());
  return { items, generatedAt, version };
}

async function writeSnapshotFiles(snapshot) {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot.items, null, 2)}\n`, "utf8");
  await fs.writeFile(
    SNAPSHOT_META_PATH,
    `${JSON.stringify(
      {
        version: snapshot.version,
        generatedAt: snapshot.generatedAt,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function main() {
  const snapshot = await generateSnapshot();
  await writeSnapshotFiles(snapshot);

  const storefrontCounts = CHART_SOURCES.map((source) => {
    const count = snapshot.items.filter((item) => item.chartStorefront === source.storefront).length;
    return `${source.storefront}:${count}`;
  }).join(" ");

  console.log(
    `[recommendations:snapshot] wrote ${snapshot.items.length} items version=${snapshot.version} ${storefrontCounts}`
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? `[recommendations:snapshot] ${error.message}`
      : `[recommendations:snapshot] ${String(error)}`
  );
  process.exitCode = 1;
});
