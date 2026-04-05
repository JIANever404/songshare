import type { ShareGame } from "@/lib/share/types";

export const SONG_SHARE_MAX_COUNT = 9;
export const SONG_SHARE_MESSAGE_PLACEHOLDER = "这是我精心挑选的歌，分享给你听";

export type SongPlatform = "apple" | "netease" | "qq";

export interface SongPreviewItem {
  id: number | string;
  title: string;
  artist: string;
  cover: string | null;
  previewUrl: string | null;
  appleUrl: string | null;
  releaseYear?: number;
  durationMs?: number;
}

export interface SongPreviewResponse {
  ok: boolean;
  source: "itunes";
  query: string;
  preview: SongPreviewItem | null;
  noResultQuery: string | null;
  error?: string;
}

export type SongPlatformProbeStatus = "available" | "unavailable" | "unprobeable";

export interface SongPlatformProbeItem {
  platform: SongPlatform;
  label: string;
  status: SongPlatformProbeStatus;
  matchedTitle: string | null;
  matchedArtist: string | null;
  note: string | null;
  webUrl?: string | null;
  appUrl?: string | null;
}

export interface SongPlatformProbeResponse {
  ok: boolean;
  query: string;
  apple: SongPreviewItem | null;
  results: SongPlatformProbeItem[];
  error?: string;
}

const SONG_PLATFORM_LABELS: Record<SongPlatform, string> = {
  apple: "Apple Music",
  netease: "网易云音乐",
  qq: "QQ 音乐",
};

function trimText(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

export function getSongShareSubtitle(count: number, shareMessage?: string | null) {
  const message = trimText(shareMessage);
  if (message) {
    return message;
  }
  return SONG_SHARE_MESSAGE_PLACEHOLDER;
}

export function getShareSongCount(games: Array<ShareGame | null>) {
  return games.filter(Boolean).length;
}

export function clampSongCount(count: number) {
  const normalized = Number.isFinite(count) ? Math.trunc(count) : 0;
  return Math.min(SONG_SHARE_MAX_COUNT, Math.max(0, normalized));
}

export function getSongShareTitle(creatorName: string | null | undefined, count: number) {
  const name = trimText(creatorName) || "我";
  const songCount = Math.max(1, clampSongCount(count));
  return `${name}分享给你${songCount}首歌`;
}

export function buildSongSearchQuery(game: ShareGame) {
  const parts = [trimText(game.localizedName), trimText(game.name)];
  const seen = new Set<string>();
  const unique = parts.filter((part) => {
    if (!part || seen.has(part)) return false;
    seen.add(part);
    return true;
  });
  return unique.join(" ").trim();
}

export function buildSongPlatformSearchUrl(platform: SongPlatform, game: ShareGame) {
  const query = encodeURIComponent(buildSongSearchQuery(game));
  if (platform === "apple") {
    const appleUrl = trimText(game.storeUrls?.apple);
    if (appleUrl) {
      return appleUrl;
    }
    return `https://music.apple.com/cn/search?term=${query}`;
  }
  if (platform === "netease") {
    return `https://music.163.com/#/search/m/?s=${query}&type=1`;
  }
  if (platform === "qq") {
    return `https://y.qq.com/n/ryqq/search?w=${query}&t=song`;
  }
  return `https://music.163.com/#/search/m/?s=${query}&type=1`;
}

export function buildSongPlatformAppSearchUrl(platform: SongPlatform, game: ShareGame) {
  const query = encodeURIComponent(buildSongSearchQuery(game));
  if (platform === "apple") {
    return buildSongPlatformSearchUrl("apple", game);
  }
  if (platform === "netease") {
    return `orpheus://search?keyword=${query}`;
  }
  if (platform === "qq") {
    return `qqmusic://qq.com/ui/search?key=${query}`;
  }
  return null;
}

export function getSongPlatformLabel(platform: SongPlatform) {
  return SONG_PLATFORM_LABELS[platform];
}
