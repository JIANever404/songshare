import { NextResponse } from "next/server";
import { searchItunesSongPreviewCandidates } from "@/lib/itunes/search";
import { SongPreviewItem, SongPreviewResponse } from "@/lib/song-share";
import { normalizeSearchQuery } from "@/lib/search/query";

const CACHE_CONTROL_VALUE = "public, max-age=0, s-maxage=900, stale-while-revalidate=86400";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function normalizeMatchText(value: string | null | undefined) {
  return normalizeSearchQuery(value).replace(/\s+/g, "");
}

function scorePreviewCandidate(
  candidate: SongPreviewItem,
  title: string,
  artist: string
) {
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

function buildQuery(title: string, artist: string) {
  return [normalizeSearchQuery(title), normalizeSearchQuery(artist)].filter(Boolean).join(" ").trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = normalizeSearchQuery(searchParams.get("title"));
  const artist = normalizeSearchQuery(searchParams.get("artist"));
  const query = buildQuery(title, artist);

  if (!title) {
    return NextResponse.json<SongPreviewResponse>(
      {
        ok: false,
        source: "itunes",
        query,
        preview: null,
        noResultQuery: null,
        error: "缺少歌曲名称",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      }
    );
  }

  try {
    const candidates = await searchItunesSongPreviewCandidates({ query });
    const preview =
      [...candidates]
        .sort((left, right) => scorePreviewCandidate(right, title, artist) - scorePreviewCandidate(left, title, artist))
        .find((item) => Boolean(item.previewUrl)) || null;

    return NextResponse.json<SongPreviewResponse>(
      {
        ok: true,
        source: "itunes",
        query,
        preview,
        noResultQuery: preview ? null : query,
      },
      {
        headers: preview
          ? {
              "Cache-Control": CACHE_CONTROL_VALUE,
              "CDN-Cache-Control": CACHE_CONTROL_VALUE,
            }
          : NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    return NextResponse.json<SongPreviewResponse>(
      {
        ok: false,
        source: "itunes",
        query,
        preview: null,
        noResultQuery: query || null,
        error: error instanceof Error ? error.message : "获取试听失败",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      }
    );
  }
}
