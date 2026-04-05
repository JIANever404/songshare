"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MusicBackdrop } from "@/components/music/MusicBackdrop";
import { MusicPanel } from "@/components/music/MusicPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SharePlatformActions } from "@/components/share/SharePlatformActions";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ActionCluster } from "@/app/components/v3/ActionCluster";
import { InlineToast, ToastKind } from "@/app/components/v3/InlineToast";
import { SearchDialog } from "@/app/components/v3/SearchDialog";
import { SelectedGamesList } from "@/app/components/v3/SelectedGamesList";
import {
  SubjectKind,
  getSubjectKindMeta,
  getSubjectKindShareTitle,
  parseSubjectKind,
} from "@/lib/subject-kind";
import { SONG_SHARE_MESSAGE_PLACEHOLDER } from "@/lib/song-share";
import { normalizeSearchQuery } from "@/lib/search/query";
import {
  primeSongRecommendationClientCache,
  readSongRecommendationClientCache,
} from "@/lib/song/recommendations-client";
import { getShareGameEntryIds } from "@/lib/share/order";
import {
  SubjectSearchResponse,
  ShareGame,
  RecommendedShareGame,
} from "@/lib/share/types";

type ToastState = {
  kind: ToastKind;
  message: string;
} | null;

type SearchMeta = {
  noResultQuery: string | null;
};

type InitialReadonlyShareData = {
  shareId: string;
  kind: SubjectKind;
  creatorName: string | null;
  shareMessage?: string | null;
  games: Array<ShareGame | null>;
  coverOrder?: string[];
};

type SongShareV3AppMode = "editor" | "shareWorkbench";

type ShareSavePayload = {
  kind: SubjectKind;
  creatorName: string | null;
  shareMessage: string | null;
  games: Array<ShareGame | null>;
  coverOrder: string[];
};

function createSearchMeta(noResultQuery: string | null = null): SearchMeta {
  return {
    noResultQuery,
  };
}

function createEmptyGames() {
  return Array.from({ length: 9 }, () => null as ShareGame | null);
}

function sanitizeDraftEntryId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function createDraftEntryId() {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return `draft-${randomPart}`;
}

function ensureClientShareEntryId(game: ShareGame): ShareGame {
  const entryId = sanitizeDraftEntryId(game.entryId) ?? createDraftEntryId();

  return {
    ...game,
    entryId,
  };
}

function cloneGames(games: Array<ShareGame | null>) {
  return games.map((item) => {
    if (!item) return null;
    return {
      ...ensureClientShareEntryId(item),
      platforms: item.platforms ? [...item.platforms] : undefined,
      genres: item.genres ? [...item.genres] : undefined,
      storeUrls: item.storeUrls ? { ...item.storeUrls } : undefined,
    };
  });
}

function normalizeGamesForState(games?: Array<ShareGame | null>) {
  if (!Array.isArray(games) || games.length !== 9) {
    return createEmptyGames();
  }
  return cloneGames(games);
}

function compactGamesForEditing(games?: Array<ShareGame | null>) {
  const normalized = normalizeGamesForState(games);
  const selected = normalized.filter((game): game is ShareGame => Boolean(game));
  return [...selected, ...Array.from({ length: 9 - selected.length }, () => null)];
}

function getEditorHeading(creatorName: string) {
  const name = creatorName.trim();
  if (!name) return "我的歌单你听吗";
  return `${name}想分享几首歌`;
}

function createShareSavePayload(
  kind: SubjectKind,
  creatorName: string,
  shareMessage: string,
  games: Array<ShareGame | null>
): ShareSavePayload {
  const normalizedGames = cloneGames(games);

  return {
    kind,
    creatorName: creatorName.trim() || null,
    shareMessage: shareMessage.trim() || null,
    games: normalizedGames,
    coverOrder: getShareGameEntryIds(normalizedGames),
  };
}

function serializeShareGameForKey(game: ShareGame | null) {
  if (!game) return null;

  const sortedStoreUrls = game.storeUrls
    ? Object.fromEntries(
        Object.entries(game.storeUrls).sort(([left], [right]) => left.localeCompare(right))
      )
    : null;

  return {
    id: typeof game.id === "number" ? game.id : String(game.id),
    entryId: game.entryId ?? null,
    name: game.name,
    localizedName: game.localizedName ?? null,
    cover: game.cover ?? null,
    releaseYear: game.releaseYear ?? null,
    gameTypeId: game.gameTypeId ?? null,
    platforms: game.platforms ? [...game.platforms] : [],
    genres: game.genres ? [...game.genres] : [],
    comment: game.comment ?? null,
    spoiler: Boolean(game.spoiler),
    subjectType: game.subjectType ?? null,
    subjectPlatform: game.subjectPlatform ?? null,
    storeUrls: sortedStoreUrls,
  };
}

function buildSharePayloadKey(payload: ShareSavePayload) {
  return JSON.stringify({
    kind: payload.kind,
    creatorName: payload.creatorName,
    shareMessage: payload.shareMessage,
    games: payload.games.map((game) => serializeShareGameForKey(game)),
    coverOrder: [...payload.coverOrder],
  });
}

function buildPersistedPayloadKey(
  kind: SubjectKind,
  creatorName: string | null,
  shareMessage: string | null,
  games: Array<ShareGame | null>
) {
  return buildSharePayloadKey(
    createShareSavePayload(kind, creatorName || "", shareMessage || "", compactGamesForEditing(games))
  );
}

const SEARCH_CLIENT_CACHE_SESSION_KEY = "my-nine-search-cache:v1";
const SEARCH_CLIENT_CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_CLIENT_CACHE_MAX = 192;
const SEARCH_REQUEST_COOLDOWN_MS = 400;
const SHARE_NAVIGATION_FALLBACK_MS = 1400;
const MAX_SHARE_MESSAGE_LENGTH = 80;

type SearchClientCacheEntry = {
  expiresAt: number;
  response: SubjectSearchResponse;
};

function buildSearchClientCacheKey(kind: SubjectKind, query: string) {
  return `${kind}:${normalizeSearchQuery(query)}`;
}

function pruneExpiredSearchClientCache(cache: Map<string, SearchClientCacheEntry>, now = Date.now()) {
  const expiredKeys: string[] = [];
  cache.forEach((value, key) => {
    if (!value || typeof value.expiresAt !== "number" || value.expiresAt <= now) {
      expiredKeys.push(key);
    }
  });
  for (const key of expiredKeys) {
    cache.delete(key);
  }
}

function trimSearchClientCache(cache: Map<string, SearchClientCacheEntry>) {
  while (cache.size > SEARCH_CLIENT_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) return;
    cache.delete(firstKey);
  }
}

function readSearchClientCacheFromSession() {
  if (typeof window === "undefined") return new Map<string, SearchClientCacheEntry>();

  try {
    const raw = sessionStorage.getItem(SEARCH_CLIENT_CACHE_SESSION_KEY);
    if (!raw) return new Map<string, SearchClientCacheEntry>();

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map<string, SearchClientCacheEntry>();

    const restored = new Map<string, SearchClientCacheEntry>();
    for (const item of parsed) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [key, value] = item as [unknown, unknown];
      if (typeof key !== "string" || !value || typeof value !== "object") continue;
      const entry = value as Partial<SearchClientCacheEntry>;
      if (typeof entry.expiresAt !== "number" || !entry.response) continue;
      restored.set(key, {
        expiresAt: entry.expiresAt,
        response: entry.response as SubjectSearchResponse,
      });
    }

    pruneExpiredSearchClientCache(restored);
    trimSearchClientCache(restored);
    return restored;
  } catch {
    return new Map<string, SearchClientCacheEntry>();
  }
}

function writeSearchClientCacheToSession(cache: Map<string, SearchClientCacheEntry>) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(Array.from(cache.entries()));
    sessionStorage.setItem(SEARCH_CLIENT_CACHE_SESSION_KEY, serialized);
  } catch {
    // ignore write errors
  }
}

function stripRecommendedGameMetadata(game: ShareGame | RecommendedShareGame): ShareGame {
  const { chartRank, chartStorefront, isHot, ...rest } = game as ShareGame &
    Partial<RecommendedShareGame>;
  void chartRank;
  void chartStorefront;
  void isHot;
  return rest;
}

function getRecommendationSongKey(game: RecommendedShareGame) {
  const normalizedSongName = (game.localizedName || game.name || "").trim().toLowerCase();
  const normalizedArtistName = (game.name || "").trim().toLowerCase();
  const normalizedId =
    typeof game.id === "string" || typeof game.id === "number" ? String(game.id).trim() : "";

  return normalizedId || `${normalizedSongName}::${normalizedArtistName}`;
}

function dedupeRecommendations(items: RecommendedShareGame[]) {
  const seen = new Set<string>();
  const deduped: RecommendedShareGame[] = [];

  for (const item of items) {
    const key = getRecommendationSongKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function shuffleRecommendations(items: RecommendedShareGame[]) {
  const next = dedupeRecommendations(items);
  if (next.length <= 1) return [...next];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

interface SongShareV3AppProps {
  kind: SubjectKind;
  mode?: SongShareV3AppMode;
  initialShareId?: string | null;
  initialShareData?: InitialReadonlyShareData | null;
}

export default function SongShareV3App({
  kind,
  mode = "editor",
  initialShareId = null,
  initialShareData = null,
}: SongShareV3AppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const kindMeta = useMemo(() => getSubjectKindMeta(kind), [kind]);
  const isEditor = mode === "editor";
  const isShareWorkbench = mode === "shareWorkbench";

  const [games, setGames] = useState<Array<ShareGame | null>>(() =>
    compactGamesForEditing(initialShareData?.games)
  );
  const [creatorName, setCreatorName] = useState(initialShareData?.creatorName || "");
  const [shareMessage, setShareMessage] = useState(initialShareData?.shareMessage || "");
  const [shareId, setShareId] = useState<string | null>(
    isShareWorkbench ? initialShareData?.shareId || initialShareId : null
  );
  const [persistedPayloadKey, setPersistedPayloadKey] = useState<string | null>(() => {
    if (!isShareWorkbench || !initialShareData) {
      return null;
    }
    return buildPersistedPayloadKey(
      kind,
      initialShareData.creatorName,
      initialShareData.shareMessage ?? null,
      initialShareData.games
    );
  });
  const [loadingShare, setLoadingShare] = useState(
    isShareWorkbench ? Boolean(initialShareId) && !initialShareData : false
  );
  const [savingShare, setSavingShare] = useState(false);

  const [toast, setToast] = useState<ToastState>(null);

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<ShareGame[]>([]);
  const [searchRecommendations, setSearchRecommendations] = useState<RecommendedShareGame[]>([]);
  const [searchRecommendationsLoading, setSearchRecommendationsLoading] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchCommittedQuery, setSearchCommittedQuery] = useState("");
  const searchClientCacheRef = useRef<Map<string, SearchClientCacheEntry>>(new Map());
  const searchClientCacheHydratedRef = useRef(false);
  const lastSearchRequestRef = useRef<{ key: string; requestedAt: number } | null>(null);
  const searchRequestVersionRef = useRef(0);
  const recommendationRequestVersionRef = useRef(0);
  const navigationFallbackTimerRef = useRef<number | null>(null);
  const navigationFallbackTargetRef = useRef<string | null>(null);
  const [searchMeta, setSearchMeta] = useState<SearchMeta>(
    createSearchMeta()
  );

  const filledCount = useMemo(() => games.filter((item) => item !== null).length, [games]);
  const currentSharePayload = useMemo(
    () => createShareSavePayload(kind, creatorName, shareMessage, games),
    [creatorName, games, kind, shareMessage]
  );
  const currentSharePayloadKey = useMemo(
    () => buildSharePayloadKey(currentSharePayload),
    [currentSharePayload]
  );
  const activeShareId =
    isShareWorkbench && persistedPayloadKey !== currentSharePayloadKey ? null : shareId;

  const shareTitle = getSubjectKindShareTitle(kind, {
    creatorName,
    selectedCount: filledCount,
  });
  const pageTitle = isShareWorkbench ? shareTitle : getEditorHeading(creatorName);
  function ensureSearchClientCacheHydrated() {
    if (searchClientCacheHydratedRef.current) return;
    searchClientCacheRef.current = readSearchClientCacheFromSession();
    searchClientCacheHydratedRef.current = true;
  }

  function persistSearchClientCache() {
    writeSearchClientCacheToSession(searchClientCacheRef.current);
  }

  function resetSearchDialogState() {
    searchRequestVersionRef.current += 1;
    recommendationRequestVersionRef.current += 1;
    setSearchQuery("");
    setSearchLoading(false);
    setSearchError("");
    setSearchResults([]);
    setSearchActiveIndex(-1);
    setSearchCommittedQuery("");
    setSearchMeta(createSearchMeta());
    const cachedRecommendations = readSongRecommendationClientCache(kind);
    setSearchRecommendations(shuffleRecommendations(cachedRecommendations?.items ?? []));
    setSearchRecommendationsLoading(false);
  }

  const loadSearchRecommendations = useEffectEvent(async (force = false) => {
    const cached = !force ? readSongRecommendationClientCache(kind) : null;
    if (cached) {
      setSearchRecommendations(shuffleRecommendations(cached.items));
      setSearchRecommendationsLoading(false);
      return;
    }

    const requestVersion = ++recommendationRequestVersionRef.current;
    setSearchRecommendationsLoading(true);

    try {
      const response = await primeSongRecommendationClientCache(kind, { force });
      if (requestVersion !== recommendationRequestVersionRef.current) {
        return;
      }

      if (!response?.ok || !Array.isArray(response.items)) {
        setSearchRecommendations([]);
        return;
      }

      setSearchRecommendations(shuffleRecommendations(response.items));
    } catch {
      if (requestVersion !== recommendationRequestVersionRef.current) {
        return;
      }
      setSearchRecommendations([]);
    } finally {
      if (requestVersion === recommendationRequestVersionRef.current) {
        setSearchRecommendationsLoading(false);
      }
    }
  });

  function clearNavigationFallback() {
    if (navigationFallbackTimerRef.current !== null) {
      window.clearTimeout(navigationFallbackTimerRef.current);
      navigationFallbackTimerRef.current = null;
    }
    navigationFallbackTargetRef.current = null;
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (searchClientCacheHydratedRef.current) return;
    searchClientCacheRef.current = readSearchClientCacheFromSession();
    searchClientCacheHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    if (normalizeSearchQuery(searchQuery).length > 0) return;
    void loadSearchRecommendations();
  }, [kind, searchOpen, searchQuery]);

  useEffect(() => {
    const pendingTarget = navigationFallbackTargetRef.current;
    if (!pendingTarget) return;
    const currentPathWithSearch =
      typeof window === "undefined" ? pathname : `${window.location.pathname}${window.location.search}`;
    if (currentPathWithSearch !== pendingTarget) return;
    if (navigationFallbackTimerRef.current !== null) {
      window.clearTimeout(navigationFallbackTimerRef.current);
      navigationFallbackTimerRef.current = null;
    }
    navigationFallbackTargetRef.current = null;
  }, [pathname]);

  useEffect(
    () => () => {
      if (navigationFallbackTimerRef.current !== null) {
        window.clearTimeout(navigationFallbackTimerRef.current);
      }
      navigationFallbackTimerRef.current = null;
      navigationFallbackTargetRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!initialShareData) return;
    if (!isShareWorkbench) return;
    if (initialShareData.kind !== kind) return;

    setGames(compactGamesForEditing(initialShareData.games));
    setCreatorName(initialShareData.creatorName || "");
    setShareMessage(initialShareData.shareMessage || "");
    setShareId(initialShareData.shareId);
    setPersistedPayloadKey(
      buildPersistedPayloadKey(
        kind,
        initialShareData.creatorName,
        initialShareData.shareMessage ?? null,
        initialShareData.games
      )
    );
    setLoadingShare(false);
  }, [initialShareData, isShareWorkbench, kind]);

  useEffect(() => {
    if (!isShareWorkbench) return;
    if (!initialShareId) return;
    if (initialShareData) return;
    const currentShareId: string = initialShareId;
    let active = true;

    async function loadShared() {
      setLoadingShare(true);
      try {
        const response = await fetch(`/api/share?id=${encodeURIComponent(currentShareId)}`);
        const json = await response.json();
        if (!active) return;
        if (!response.ok || !json?.ok) {
          setToast({ kind: "error", message: json?.error || "共享页面加载失败" });
          setLoadingShare(false);
          return;
        }

        const responseKind = parseSubjectKind(json.kind) ?? "song";
        if (responseKind !== kind) {
          setToast({ kind: "error", message: "分享类型与页面不匹配" });
          setLoadingShare(false);
          router.replace(`/${responseKind}/s/${json.shareId || currentShareId}`);
          return;
        }

        const payloadGames = Array.isArray(json.games) ? json.games : createEmptyGames();
        const normalizedGames = compactGamesForEditing(payloadGames.length === 9 ? payloadGames : createEmptyGames());
        setGames(normalizedGames);
        setCreatorName(typeof json.creatorName === "string" ? json.creatorName : "");
        setShareMessage(typeof json.shareMessage === "string" ? json.shareMessage : "");
        setShareId(json.shareId || currentShareId);
        setPersistedPayloadKey(
          buildPersistedPayloadKey(
            kind,
            typeof json.creatorName === "string" ? json.creatorName : "",
            typeof json.shareMessage === "string" ? json.shareMessage : "",
            normalizedGames
          )
        );
      } catch {
        if (!active) return;
        setToast({ kind: "error", message: "共享页面加载失败" });
      } finally {
        if (active) {
          setLoadingShare(false);
        }
      }
    }

    loadShared();
    return () => {
      active = false;
    };
  }, [initialShareData, initialShareId, isShareWorkbench, kind, router]);

  function pushToast(kindValue: ToastKind, message: string) {
    setToast({ kind: kindValue, message });
  }

  function updateSlot(index: number, game: ShareGame | null) {
    setGames((prev) => {
      const next = compactGamesForEditing(prev);
      next[index] = game;
      return compactGamesForEditing(next);
    });
  }

  function reorderSelectedGames(fromPosition: number, toPosition: number) {
    setGames((prev) => {
      const next = compactGamesForEditing(prev);
      const selectedGames = next.filter((game): game is ShareGame => Boolean(game));
      if (
        fromPosition < 0 ||
        toPosition < 0 ||
        fromPosition >= selectedGames.length ||
        toPosition >= selectedGames.length ||
        fromPosition === toPosition
      ) {
        return next;
      }

      const [moved] = selectedGames.splice(fromPosition, 1);
      if (!moved) return next;
      selectedGames.splice(toPosition, 0, moved);
      return [
        ...selectedGames,
        ...Array.from({ length: 9 - selectedGames.length }, () => null),
      ];
    });
  }

  function beginNavigation(target: string) {
    clearNavigationFallback();
    navigationFallbackTargetRef.current = target;
    router.push(target);
    navigationFallbackTimerRef.current = window.setTimeout(() => {
      const fallbackTarget = navigationFallbackTargetRef.current;
      if (!fallbackTarget) return;
      const currentPathWithSearch = `${window.location.pathname}${window.location.search}`;
      if (currentPathWithSearch !== fallbackTarget) {
        window.location.assign(fallbackTarget);
      }
      clearNavigationFallback();
    }, SHARE_NAVIGATION_FALLBACK_MS);
  }

  async function handleSearch() {
    const normalizedQuery = normalizeSearchQuery(searchQuery);
    if (!normalizedQuery) {
      setSearchError("请输入关键词");
      return;
    }

    ensureSearchClientCacheHydrated();

    const cacheKey = buildSearchClientCacheKey(kind, normalizedQuery);
    const now = Date.now();
    const lastRequest = lastSearchRequestRef.current;
    if (
      lastRequest &&
      lastRequest.key === cacheKey &&
      now - lastRequest.requestedAt < SEARCH_REQUEST_COOLDOWN_MS
    ) {
      return;
    }

    const cached = searchClientCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      const response = cached.response;
      setSearchError("");
      setSearchCommittedQuery(normalizedQuery);
      setSearchResults(Array.isArray(response.items) ? response.items : []);
      setSearchMeta({
        noResultQuery: typeof response.noResultQuery === "string" ? response.noResultQuery : null,
      });
      setSearchActiveIndex(response.items.length > 0 ? 0 : -1);
      return;
    }

    if (cached) {
      searchClientCacheRef.current.delete(cacheKey);
      persistSearchClientCache();
    }

    lastSearchRequestRef.current = {
      key: cacheKey,
      requestedAt: now,
    };
    const requestVersion = ++searchRequestVersionRef.current;
    setSearchLoading(true);
    setSearchError("");
    setSearchActiveIndex(-1);
    setSearchCommittedQuery(normalizedQuery);

    try {
      const response = await fetch(
        `/api/subjects/search?q=${encodeURIComponent(normalizedQuery)}&kind=${encodeURIComponent(kind)}`
      );
      const json = (await response.json()) as Partial<SubjectSearchResponse> & {
        ok?: boolean;
        error?: string;
      };

      if (requestVersion !== searchRequestVersionRef.current) {
        return;
      }

      if (!response.ok || !json?.ok) {
        setSearchError(json?.error || "搜索失败，请稍后再试");
        setSearchResults([]);
        setSearchMeta(createSearchMeta(normalizedQuery));
        return;
      }

      const nextResponse: SubjectSearchResponse = {
        ok: true,
        source: "itunes",
        kind,
        items: Array.isArray(json.items) ? json.items : [],
        noResultQuery: typeof json.noResultQuery === "string" ? json.noResultQuery : null,
      };

      searchClientCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + SEARCH_CLIENT_CACHE_TTL_MS,
        response: nextResponse,
      });
      pruneExpiredSearchClientCache(searchClientCacheRef.current);
      trimSearchClientCache(searchClientCacheRef.current);
      persistSearchClientCache();

      setSearchResults(nextResponse.items);
      setSearchMeta({
        noResultQuery: nextResponse.noResultQuery,
      });
      setSearchActiveIndex(nextResponse.items.length > 0 ? 0 : -1);
    } catch {
      if (requestVersion !== searchRequestVersionRef.current) {
        return;
      }
      setSearchError("搜索失败，请稍后再试");
      setSearchResults([]);
      setSearchMeta(createSearchMeta(normalizedQuery));
    } finally {
      if (requestVersion === searchRequestVersionRef.current) {
        setSearchLoading(false);
      }
    }
  }

  function openSearch(index: number) {
    if (!isEditor) return;
    setSelectedSlot(index);
    resetSearchDialogState();
    window.setTimeout(() => setSearchOpen(true), 0);
  }

  function handleAddSong() {
    if (!isEditor) return;
    const firstEmptyIndex = games.findIndex((game) => !game);
    if (firstEmptyIndex < 0) {
      pushToast("info", "最多选择 9 首歌");
      return;
    }
    openSearch(firstEmptyIndex);
  }

  function selectSearchResult(game: ShareGame | RecommendedShareGame) {
    if (!isEditor) return;
    if (selectedSlot === null) return;
    const targetSlot = selectedSlot;
    const pickedGame = stripRecommendedGameMetadata(game);

    const duplicateIndex = games.findIndex(
      (item, index) => index !== targetSlot && item && String(item.id) === String(pickedGame.id)
    );

    if (duplicateIndex >= 0) {
      setGames((prev) => {
        const next = compactGamesForEditing(prev);
        const current = next[targetSlot];
        const duplicate = next[duplicateIndex];
        next[targetSlot] = duplicate ? { ...duplicate } : null;
        next[duplicateIndex] = current ? { ...current } : null;
        return compactGamesForEditing(next);
      });
      setSearchOpen(false);
      setSelectedSlot(null);
      pushToast("success", `已与第 ${duplicateIndex + 1} ${kindMeta.selectionUnit}互换`);
      return;
    }

    updateSlot(targetSlot, {
      ...pickedGame,
    });

    setSearchOpen(false);
    setSelectedSlot(null);
    pushToast("success", `已填入第 ${targetSlot + 1} ${kindMeta.selectionUnit}`);
  }

  async function persistCurrentShare() {
    if (filledCount === 0) {
      pushToast("info", isEditor ? "先选一首歌再保存" : "先选一首歌再生成");
      return null;
    }

    if (isShareWorkbench && persistedPayloadKey === currentSharePayloadKey && shareId) {
      return shareId;
    }

    setSavingShare(true);
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentSharePayload),
      });

      const json = await response.json();
      if (!response.ok || !json?.ok) {
        pushToast("error", json?.error || "分享创建失败");
        return null;
      }

      const nextShareId = typeof json.shareId === "string" ? json.shareId : null;
      if (!nextShareId) {
        pushToast("error", "分享创建失败");
        return null;
      }

      setShareId(nextShareId);
      if (isShareWorkbench) {
        setPersistedPayloadKey(currentSharePayloadKey);
      }
      return nextShareId;
    } catch {
      pushToast("error", "分享创建失败，请稍后重试");
      return null;
    } finally {
      setSavingShare(false);
    }
  }

  async function handleSaveShare() {
    if (!isEditor) return;

    const nextShareId = await persistCurrentShare();
    if (!nextShareId) return;

    beginNavigation(`/${kind}/s/${nextShareId}`);
  }

  async function handleResolveShareId() {
    return persistCurrentShare();
  }

  function handleNotice(kindValue: ToastKind, message: string) {
    pushToast(kindValue, message);
  }

  return (
    <main className="relative isolate min-h-screen overflow-hidden px-4 py-5 text-foreground">
      <MusicBackdrop compact />
      <div className="relative z-10 mx-auto flex w-full max-w-[430px] flex-col gap-4">
        <MusicPanel className={isShareWorkbench ? "space-y-3 px-5 pb-5 pt-3" : "space-y-4 p-5"}>
          <div className="space-y-2">
            <p className="music-kicker">{isShareWorkbench ? "我的歌单你听吗" : "Song Share"}</p>
            <h1 className="flex-1 text-[2.35rem] font-black leading-[0.94] text-foreground">
              {pageTitle}
            </h1>
            {isEditor ? (
              <p className="text-sm leading-6 text-muted-foreground">
                选几首歌，拖动排好顺序后生成分享页。
              </p>
            ) : null}
          </div>

          {isEditor ? (
            <div className="flex flex-wrap gap-2">
              <span className="music-chip">已选 {filledCount} 首歌</span>
            </div>
          ) : null}
        </MusicPanel>

        {toast ? (
          <div className="pointer-events-none fixed -left-[200vw] top-0 opacity-0" aria-live="polite">
            <InlineToast kind={toast.kind} message={toast.message} />
          </div>
        ) : null}

        <SelectedGamesList
          games={games}
          subjectLabel={kindMeta.label}
          kind={kind}
          creatorName={creatorName}
          mode={isShareWorkbench ? "shareWorkbench" : "editor"}
          loading={loadingShare}
          onAddSong={isEditor ? handleAddSong : undefined}
          onEditSong={isEditor ? openSearch : undefined}
          onReorderSong={reorderSelectedGames}
          onRemoveSong={isEditor ? (index) => updateSlot(index, null) : undefined}
        />

        <MusicPanel className="space-y-3 p-5">
          {isShareWorkbench ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">分享者</p>
                <p className="truncate text-base font-bold text-foreground">{creatorName.trim() || "匿名"}</p>
                {shareMessage.trim() ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {shareMessage.trim()}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void primeSongRecommendationClientCache(kind);
                  router.push("/");
                }}
              >
                我也要分享
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-foreground">分享者</label>
              <Input
                value={creatorName}
                onChange={(event) => setCreatorName(event.target.value.slice(0, 40))}
                placeholder="输入你的昵称"
                className="w-full"
              />
              <p className="text-right text-xs text-muted-foreground">{creatorName.length}/40</p>

              <label className="block pt-2 text-sm font-semibold text-foreground">想说的话</label>
              <textarea
                value={shareMessage}
                onChange={(event) => setShareMessage(event.target.value.slice(0, MAX_SHARE_MESSAGE_LENGTH))}
                placeholder={SONG_SHARE_MESSAGE_PLACEHOLDER}
                rows={3}
                className="flex min-h-[104px] w-full resize-none rounded-[1.25rem] border border-border/80 bg-card/75 px-4 py-3 text-sm leading-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-sm transition-all placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-right text-xs text-muted-foreground">{shareMessage.length}/{MAX_SHARE_MESSAGE_LENGTH}</p>
            </div>
          )}
        </MusicPanel>

        <MusicPanel className="p-4">
          {isEditor ? (
            <ActionCluster
              filledCount={filledCount}
              readOnly={false}
              saving={savingShare}
              onSave={handleSaveShare}
            />
          ) : (
            <SharePlatformActions
              kind={kind}
              shareId={activeShareId}
              games={games}
              creatorName={creatorName}
              shareMessage={shareMessage}
              onResolveShareId={handleResolveShareId}
              onNotice={handleNotice}
            />
          )}
        </MusicPanel>

        <SiteFooter className="w-full" kind={kind} />
      </div>

      <SearchDialog
        kind={kind}
        subjectLabel={kindMeta.label}
        dialogTitle={kindMeta.searchDialogTitle}
        inputPlaceholder={kindMeta.searchPlaceholder}
        idleHint={kindMeta.searchIdleHint}
        committedQuery={searchCommittedQuery}
        open={searchOpen}
        onOpenChange={(open) => {
          setSearchOpen(open);
          if (!open) {
            setSelectedSlot(null);
            resetSearchDialogState();
          }
        }}
        query={searchQuery}
        onQueryChange={(value) => {
          setSearchQuery(value);
          setSearchError("");
          setSearchActiveIndex(-1);
          if (value.trim().length === 0) {
            setSearchResults([]);
            setSearchCommittedQuery("");
            setSearchMeta(createSearchMeta());
          }
        }}
        loading={searchLoading}
        error={searchError}
        results={searchResults}
        recommendations={searchRecommendations}
        recommendationsLoading={searchRecommendationsLoading}
        noResultQuery={searchMeta.noResultQuery}
        activeIndex={searchActiveIndex}
        onActiveIndexChange={setSearchActiveIndex}
        onSubmitSearch={handleSearch}
        onPickGame={selectSearchResult}
      />
    </main>
  );
}
