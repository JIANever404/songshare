import { NextResponse } from "next/server";
import { searchItunesSongPreviewCandidates } from "@/lib/itunes/search";
import {
  SongPlatformProbeItem,
  SongPlatformProbeResponse,
  SongPreviewItem,
} from "@/lib/song-share";
import { normalizeSearchQuery } from "@/lib/search/query";

const CACHE_CONTROL_VALUE = "public, max-age=0, s-maxage=900, stale-while-revalidate=86400";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

const DEFAULT_FETCH_HEADERS = {
  Accept: "application/json,text/plain,*/*",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
} as const;

type QqSongResult = {
  songid?: number;
  songmid?: string;
  songname?: string;
  singer?: Array<{ name?: string }>;
  stream?: number;
};

type QqSearchResponse = {
  code?: number;
  data?: {
    song?: {
      list?: QqSongResult[];
    };
  };
};

type NeteaseSongResult = {
  id?: number;
  name?: string;
  artists?: Array<{ name?: string }>;
  status?: number;
};

type NeteaseSearchResponse = {
  code?: number;
  result?: {
    songs?: NeteaseSongResult[];
  };
};

type CandidateSummary = {
  id: string | number | null;
  title: string;
  artist: string;
  exactTitle: boolean;
  artistMatch: boolean;
  score: number;
};

function normalizeMatchText(value: string | null | undefined) {
  return normalizeSearchQuery(value)
    .replace(/[\s\-_/\\|()[\]{}<>《》【】“”‘’"'`·•,，.。!！?？:：;；]/g, "")
    .trim();
}

function normalizeArtistList(value: Array<string>) {
  return value
    .map((item) => normalizeMatchText(item))
    .filter(Boolean);
}

function computeCharacterOverlap(left: string, right: string) {
  if (!left || !right) return 0;

  const rightChars = right.split("");
  let matches = 0;

  for (const char of left.split("")) {
    const index = rightChars.indexOf(char);
    if (index >= 0) {
      matches += 1;
      rightChars.splice(index, 1);
    }
  }

  return matches / Math.max(left.length, right.length);
}

function artistMatches(candidateArtists: Array<string>, targetArtist: string) {
  const target = normalizeMatchText(targetArtist);
  if (!target) {
    return true;
  }

  const candidateList = normalizeArtistList(candidateArtists);
  return candidateList.some((candidate) => {
    if (candidate === target || candidate.includes(target) || target.includes(candidate)) {
      return true;
    }
    return computeCharacterOverlap(candidate, target) >= 0.6;
  });
}

function buildQuery(title: string, artist: string) {
  return [normalizeSearchQuery(title), normalizeSearchQuery(artist)].filter(Boolean).join(" ").trim();
}

function buildSearchTerms(title: string, artist: string) {
  const combined = buildQuery(title, artist);
  return Array.from(new Set([combined, normalizeSearchQuery(title)].filter(Boolean)));
}

function buildCandidateSummary(params: {
  id?: string | number | null;
  candidateTitle: string;
  candidateArtists: Array<string>;
  title: string;
  artist: string;
}): CandidateSummary {
  const { id = null, candidateTitle, candidateArtists, title, artist } = params;
  const titleText = normalizeMatchText(candidateTitle);
  const targetTitle = normalizeMatchText(title);
  const artistText = candidateArtists.join(" / ");
  const exactTitle = Boolean(titleText && targetTitle && titleText === targetTitle);
  const isArtistMatch = artistMatches(candidateArtists, artist);

  let score = 0;
  if (exactTitle) score += 400;
  if (titleText.startsWith(targetTitle) && targetTitle) score += 120;
  if (titleText.includes(targetTitle) && targetTitle) score += 60;
  if (isArtistMatch) score += 220;

  return {
    id,
    title: candidateTitle,
    artist: artistText,
    exactTitle,
    artistMatch: isArtistMatch,
    score,
  };
}

function pickBestCandidate(items: CandidateSummary[]) {
  return [...items].sort((left, right) => right.score - left.score)[0] ?? null;
}

function scoreApplePreviewCandidate(candidate: SongPreviewItem, title: string, artist: string) {
  const candidateTitle = normalizeMatchText(candidate.title);
  const candidateArtist = normalizeMatchText(candidate.artist);
  const targetTitle = normalizeMatchText(title);
  const targetArtist = normalizeMatchText(artist);

  let score = 0;

  if (targetTitle) {
    if (candidateTitle === targetTitle) score += 220;
    else if (candidateTitle.startsWith(targetTitle)) score += 120;
    else if (candidateTitle.includes(targetTitle)) score += 60;
  }

  if (targetArtist) {
    if (candidateArtist === targetArtist) score += 140;
    else if (candidateArtist.startsWith(targetArtist)) score += 70;
    else if (candidateArtist.includes(targetArtist)) score += 35;
  }

  if (candidate.previewUrl) {
    score += 80;
  }

  return score;
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...DEFAULT_FETCH_HEADERS,
      ...(init?.headers ?? {}),
    },
    next: { revalidate: 0 },
  } as RequestInit & { next?: { revalidate?: number } });

  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function probeQq(title: string, artist: string): Promise<SongPlatformProbeItem> {
  const terms = buildSearchTerms(title, artist);
  const candidates = new Map<string, CandidateSummary>();

  for (const term of terms) {
    const url = new URL("https://c.y.qq.com/soso/fcgi-bin/client_search_cp");
    url.searchParams.set("w", term);
    url.searchParams.set("p", "1");
    url.searchParams.set("n", "8");
    url.searchParams.set("format", "json");

    const json = await fetchJson<QqSearchResponse>(url.toString(), {
      headers: {
        Referer: "https://y.qq.com/",
      },
    });

    const list = Array.isArray(json.data?.song?.list) ? json.data?.song?.list : [];
    for (const item of list) {
      const candidateTitle = item.songname?.trim();
      const candidateArtists = (item.singer ?? [])
        .map((entry) => entry.name?.trim() || "")
        .filter(Boolean);

      if (!candidateTitle || candidateArtists.length === 0 || item.stream === 0) {
        continue;
      }

      const summary = buildCandidateSummary({
        id: item.songmid || item.songid || null,
        candidateTitle,
        candidateArtists,
        title,
        artist,
      });
      const key = item.songmid || `${candidateTitle}-${candidateArtists.join("/")}`;
      const current = candidates.get(key);
      if (!current || summary.score > current.score) {
        candidates.set(key, summary);
      }
    }
  }

  const best = pickBestCandidate(Array.from(candidates.values()));
  if (best?.exactTitle && best.artistMatch) {
    return {
      platform: "qq",
      label: "QQ 音乐",
      status: "available",
      matchedTitle: best.title,
      matchedArtist: best.artist,
      note: "已找到原曲",
      webUrl: typeof best.id === "string" ? `https://y.qq.com/n/ryqq/songDetail/${best.id}` : null,
      appUrl:
        typeof best.id === "string"
          ? `qqmusic://qq.com/media/playSonglist?p=${encodeURIComponent(
              JSON.stringify({
                action: "play",
                fromtag: 30,
                song: [{ type: "0", songmid: best.id }],
              })
            )}`
          : null,
    };
  }

  return {
    platform: "qq",
    label: "QQ 音乐",
    status: "unavailable",
    matchedTitle: best?.title ?? null,
    matchedArtist: best?.artist ?? null,
    note: best ? "未找到歌名与歌手同时匹配的原曲结果" : "未找到相关结果",
  };
}

async function probeNetease(title: string, artist: string): Promise<SongPlatformProbeItem> {
  const terms = buildSearchTerms(title, artist);
  const candidates = new Map<string, CandidateSummary>();

  for (const term of terms) {
    const url = new URL("https://music.163.com/api/search/get/web");
    url.searchParams.set("csrf_token", "");
    url.searchParams.set("s", term);
    url.searchParams.set("type", "1");
    url.searchParams.set("offset", "0");
    url.searchParams.set("limit", "10");

    const json = await fetchJson<NeteaseSearchResponse>(url.toString(), {
      headers: {
        Referer: "https://music.163.com/",
      },
    });

    const list = Array.isArray(json.result?.songs) ? json.result?.songs : [];
    for (const item of list) {
      const candidateTitle = item.name?.trim();
      const candidateArtists = (item.artists ?? [])
        .map((entry) => entry.name?.trim() || "")
        .filter(Boolean);

      if (!candidateTitle || candidateArtists.length === 0 || item.status !== 0) {
        continue;
      }

      const summary = buildCandidateSummary({
        id: item.id || null,
        candidateTitle,
        candidateArtists,
        title,
        artist,
      });
      const key = String(item.id || `${candidateTitle}-${candidateArtists.join("/")}`);
      const current = candidates.get(key);
      if (!current || summary.score > current.score) {
        candidates.set(key, summary);
      }
    }
  }

  const best = pickBestCandidate(Array.from(candidates.values()));
  if (best?.exactTitle && best.artistMatch) {
    return {
      platform: "netease",
      label: "网易云音乐",
      status: "available",
      matchedTitle: best.title,
      matchedArtist: best.artist,
      note: "已找到原曲",
      webUrl: typeof best.id === "number" ? `https://music.163.com/song?id=${best.id}` : null,
      appUrl: typeof best.id === "number" ? `orpheus://song/${best.id}` : null,
    };
  }

  return {
    platform: "netease",
    label: "网易云音乐",
    status: "unavailable",
    matchedTitle: best?.title ?? null,
    matchedArtist: best?.artist ?? null,
    note: best ? "未找到歌名与歌手同时匹配的原曲结果" : "未找到相关结果",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = normalizeSearchQuery(searchParams.get("title"));
  const artist = normalizeSearchQuery(searchParams.get("artist"));
  const query = buildQuery(title, artist);

  if (!title) {
    return NextResponse.json<SongPlatformProbeResponse>(
      {
        ok: false,
        query,
        apple: null,
        results: [],
        error: "缺少歌曲名称",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      }
    );
  }

  try {
    const [appleCandidatesResult, qqResult, neteaseResult] = await Promise.allSettled([
      searchItunesSongPreviewCandidates({ query }),
      probeQq(title, artist),
      probeNetease(title, artist),
    ]);

    const appleCandidates =
      appleCandidatesResult.status === "fulfilled" ? appleCandidatesResult.value : [];

    const apple =
      [...appleCandidates]
        .sort(
          (left, right) =>
            scoreApplePreviewCandidate(right, title, artist) - scoreApplePreviewCandidate(left, title, artist)
        )
        .find((item) => Boolean(item.appleUrl)) || null;

    const availableResults = [neteaseResult, qqResult]
      .filter((item): item is PromiseFulfilledResult<SongPlatformProbeItem> => item.status === "fulfilled")
      .map((item) => item.value)
      .filter((item) => item.status === "available");

    return NextResponse.json<SongPlatformProbeResponse>(
      {
        ok: true,
        query,
        apple,
        results: availableResults,
      },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL_VALUE,
          "CDN-Cache-Control": CACHE_CONTROL_VALUE,
        },
      }
    );
  } catch (error) {
    return NextResponse.json<SongPlatformProbeResponse>(
      {
        ok: false,
        query,
        apple: null,
        results: [],
        error: error instanceof Error ? error.message : "获取平台探测结果失败",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      }
    );
  }
}
