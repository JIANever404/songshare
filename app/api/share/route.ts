import { NextResponse } from "next/server";
import { createShareId, normalizeShareId } from "@/lib/share/id";
import { buildStoredShareEntryId, normalizeShareEntryId } from "@/lib/share/entry-id";
import { getShareGameEntryIds, normalizeCoverOrder } from "@/lib/share/order";
import { saveShare, getShare } from "@/lib/share/storage";
import { ShareGame, StoredShareV1 } from "@/lib/share/types";
import { parseSubjectKind } from "@/lib/subject-kind";

const MAX_CREATOR_LENGTH = 40;
const MAX_SHARE_MESSAGE_LENGTH = 80;
const MAX_COMMENT_LENGTH = 140;
const SHARE_GET_CDN_TTL_SECONDS = 3600;
const SHARE_GET_STALE_TTL_SECONDS = 86400;
const SHARE_GET_CACHE_CONTROL_VALUE = `public, max-age=0, s-maxage=${SHARE_GET_CDN_TTL_SECONDS}, stale-while-revalidate=${SHARE_GET_STALE_TTL_SECONDS}`;

function createShareGetCacheHeaders() {
  return {
    "Cache-Control": SHARE_GET_CACHE_CONTROL_VALUE,
    "CDN-Cache-Control": SHARE_GET_CACHE_CONTROL_VALUE,
  };
}

function sanitizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function sanitizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function sanitizeGame(input: unknown): ShareGame | null {
  const game = toRecord(input);
  if (!game) return null;

  const name = sanitizeString(game.name);
  if (!name) return null;

  const id =
    typeof game.id === "number" || typeof game.id === "string"
      ? game.id
      : String(name);
  const coverRaw = game.cover;
  const cover = typeof coverRaw === "string" && coverRaw.trim() ? coverRaw.trim() : null;

  const commentRaw = sanitizeString(game.comment);
  const comment = commentRaw ? commentRaw.slice(0, MAX_COMMENT_LENGTH) : undefined;
  const spoiler = Boolean(game.spoiler);

  const releaseYear =
    typeof game.releaseYear === "number" && Number.isFinite(game.releaseYear)
      ? Math.trunc(game.releaseYear)
      : undefined;

  const localizedName = sanitizeString(game.localizedName) || undefined;
  const genres = Array.isArray(game.genres)
    ? game.genres
        .map((item: unknown) => sanitizeString(item))
        .filter((item: string) => Boolean(item))
        .slice(0, 5)
    : undefined;

  const storeUrlsRaw = game.storeUrls;
  const storeUrls =
    storeUrlsRaw && typeof storeUrlsRaw === "object"
      ? (Object.fromEntries(
          Object.entries(storeUrlsRaw)
            .filter(([k]) => typeof k === "string")
            .map(([k, v]) => [k, sanitizeHttpUrl(v)])
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
        ) as Record<string, string>)
      : undefined;

  return {
    id,
    entryId: normalizeShareEntryId(game.entryId) ?? undefined,
    name,
    localizedName,
    cover,
    releaseYear,
    genres,
    storeUrls: storeUrls && Object.keys(storeUrls).length > 0 ? storeUrls : undefined,
    comment,
    spoiler,
  };
}

function parseGames(input: unknown): Array<ShareGame | null> | null {
  if (!Array.isArray(input) || input.length !== 9) return null;
  return input.map((item) => sanitizeGame(item));
}

function ensureGameEntryIds(games: Array<ShareGame | null>, shareId: string): Array<ShareGame | null> {
  return games.map((game, index) => {
    if (!game) return null;
    const entryId =
      normalizeShareEntryId(game.entryId) ??
      buildStoredShareEntryId({
        shareId,
        slotIndex: index,
        subjectId: game.id,
      });
    return {
      ...game,
      entryId,
    };
  });
}

function parseCoverOrder(input: unknown, games: Array<ShareGame | null>) {
  return normalizeCoverOrder(
    getShareGameEntryIds(games),
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : null
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const kind = parseSubjectKind(body?.kind);
    if (!kind) {
      return NextResponse.json(
        {
          ok: false,
          error: "kind 参数无效",
          code: "invalid_kind",
        },
        { status: 400 }
      );
    }

    const creatorNameRaw = sanitizeString(body?.creatorName);
    const creatorName = creatorNameRaw ? creatorNameRaw.slice(0, MAX_CREATOR_LENGTH) : null;
    const shareMessageRaw = sanitizeString(body?.shareMessage);
    const shareMessage = shareMessageRaw
      ? shareMessageRaw.slice(0, MAX_SHARE_MESSAGE_LENGTH)
      : null;
    const games = parseGames(body?.games);

    if (!games) {
      return NextResponse.json(
        {
          ok: false,
          error: "games 参数必须是长度为 9 的数组",
          code: "invalid_games",
        },
        { status: 400 }
      );
    }

    const shareId = createShareId();
    const now = Date.now();
    const normalizedGames = ensureGameEntryIds(games, shareId);
    const record: StoredShareV1 = {
      shareId,
      kind,
      creatorName,
      shareMessage,
      games: normalizedGames,
      coverOrder: parseCoverOrder(body?.coverOrder, normalizedGames),
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
    };

    const saveResult = await saveShare(record);
    const finalShareId = saveResult.shareId;
    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/${kind}/s/${finalShareId}`;

    return NextResponse.json({
      ok: true,
      shareId: finalShareId,
      kind,
      shareUrl,
      deduped: saveResult.deduped,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "保存失败",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = normalizeShareId(searchParams.get("id"));
  if (!id) {
    return NextResponse.json(
      {
        ok: false,
        error: "无效的分享 ID",
      },
      { status: 400 }
    );
  }

  const share = await getShare(id);
  if (!share) {
    return NextResponse.json(
      {
        ok: false,
        error: "分享不存在",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    shareId: share.shareId,
    kind: share.kind,
    creatorName: share.creatorName,
    shareMessage: share.shareMessage ?? null,
    games: share.games,
    coverOrder: share.coverOrder ?? [],
  }, {
    headers: createShareGetCacheHeaders(),
  });
}
