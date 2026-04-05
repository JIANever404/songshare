"use client";

import Image from "next/image";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  AutoScroller,
  Cursor,
  Feedback,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { ArrowDownRight, Headphones, Plus, Search, X } from "lucide-react";
import { SongPlatformSearchDialog } from "@/components/share/SongPlatformSearchDialog";
import { SongPreviewItem, SongPreviewResponse } from "@/lib/song-share";
import { ShareGame } from "@/lib/share/types";
import type { SubjectKind } from "@/lib/subject-kind";

type SelectedGamesListMode = "editor" | "shareWorkbench";

interface SelectedGamesListProps {
  games: Array<ShareGame | null>;
  subjectLabel: string;
  kind?: SubjectKind;
  creatorName?: string | null;
  mode: SelectedGamesListMode;
  loading?: boolean;
  onAddSong?: () => void;
  onEditSong?: (index: number) => void;
  onReorderSong?: (fromPosition: number, toPosition: number) => void;
  onRemoveSong?: (index: number) => void;
}

type PreviewPlayOptions = {
  suppressErrors?: boolean;
};

type PreviewLookupResult =
  | {
      status: "success";
      preview: SongPreviewItem;
    }
  | {
      status: "empty" | "error";
      preview: null;
      error?: string;
    };

type PlayerLogEntry = {
  id: number;
  level: "info" | "warn" | "error";
  event: string;
  at: number;
  playbackKey?: string | null;
  message: string;
};

const CROSSFADE_DURATION_MS = 1200;
const AUTO_CROSSFADE_HEADROOM_MS = 320;
const CROSSFADE_TRIGGER_SECONDS = (CROSSFADE_DURATION_MS + AUTO_CROSSFADE_HEADROOM_MS) / 1000;
const AUTO_CROSSFADE_UI_SWITCH_PROGRESS = 0.78;
const PREVIEW_RETRY_DELAYS_MS = [0, 250, 700] as const;
const PLAYER_LOG_LIMIT = 80;
const PREVIEW_FETCH_TIMEOUT_MS = 8000;
const AUDIO_WARMUP_TIMEOUT_MS = 260;
const DRAG_CLICK_SUPPRESS_MS = 250;

interface SortableSongRowProps {
  id: string;
  index: number;
  disabled: boolean;
  transition?: { duration?: number; easing?: string; idle?: boolean } | null;
  children: (params: { ref: (element: Element | null) => void; isDragSource: boolean }) => ReactNode;
}

function SortableSongRow({ id, index, disabled, transition, children }: SortableSongRowProps) {
  const { ref, isDragSource } = useSortable({
    id,
    index,
    disabled,
    transition,
    sensors: [
      PointerSensor.configure({
        activationConstraints(event) {
          if (event.pointerType === "touch") {
            return [
              new PointerActivationConstraints.Delay({
                value: 220,
                tolerance: 10,
              }),
            ];
          }

          return [
            new PointerActivationConstraints.Delay({
              value: 120,
              tolerance: 6,
            }),
            new PointerActivationConstraints.Distance({
              value: 4,
            }),
          ];
        },
      }),
    ],
  });

  return <>{children({ ref, isDragSource })}</>;
}

function displayName(game: ShareGame): string {
  return game.localizedName?.trim() || game.name;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function waitForAudioWarmup(audio: HTMLAudioElement) {
  return new Promise<void>((resolve) => {
    if (audio.currentTime > 0.04 || audio.readyState >= 3) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      audio.removeEventListener("timeupdate", handleReady);
      audio.removeEventListener("playing", handleReady);
      audio.removeEventListener("canplay", handleReady);
      resolve();
    };

    const handleReady = () => {
      if (audio.currentTime > 0.01 || audio.readyState >= 3) {
        finish();
      }
    };

    const timeoutId = window.setTimeout(finish, AUDIO_WARMUP_TIMEOUT_MS);
    audio.addEventListener("timeupdate", handleReady);
    audio.addEventListener("playing", handleReady);
    audio.addEventListener("canplay", handleReady);
  });
}

export function SelectedGamesList({
  games,
  subjectLabel,
  kind,
  mode,
  loading = false,
  onAddSong,
  onEditSong,
  onReorderSong,
  onRemoveSong,
}: SelectedGamesListProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstSongCardRef = useRef<HTMLElement | null>(null);
  const audioPrimaryRef = useRef<HTMLAudioElement | null>(null);
  const audioSecondaryRef = useRef<HTMLAudioElement | null>(null);
  const previewCacheRef = useRef<Map<string, SongPreviewItem | null>>(new Map());
  const activeAudioSlotRef = useRef<0 | 1>(0);
  const activePreviewKeyRef = useRef<string | null>(null);
  const activeSelectedPositionRef = useRef<number | null>(null);
  const debugListRef = useRef<HTMLDivElement | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const transitionInFlightRef = useRef(false);
  const playbackIntentRef = useRef(0);
  const playerLogIdRef = useRef(0);
  const suppressCardClickUntilRef = useRef(0);
  const [, setLoadingPreviewKey] = useState<string | null>(null);
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
  const [activeProgress, setActiveProgress] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [errorPreviewKey, setErrorPreviewKey] = useState<string | null>(null);
  const [playerLogs, setPlayerLogs] = useState<PlayerLogEntry[]>([]);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [searchGame, setSearchGame] = useState<ShareGame | null>(null);
  const [hasDismissedTapHint, setHasDismissedTapHint] = useState(false);
  const [tapHintRect, setTapHintRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const selected = useMemo(
    () =>
      games
        .map((game, index) => ({ index, game }))
        .filter((item): item is { index: number; game: ShareGame } => Boolean(item.game)),
    [games]
  );
  const isEditor = mode === "editor";
  const isPlayableSong = mode === "shareWorkbench" && kind === "song";
  const canReorder = Boolean(onReorderSong) && selected.length > 1;
  const title = kind === "song" ? "歌曲列表" : `已选${subjectLabel}`;
  const countLabel = kind === "song" ? "首" : "项";
  const emptyText = mode === "shareWorkbench" ? "还没有分享任何歌曲。" : `还没有选择任何${subjectLabel}。`;
  const canAddMore = isEditor && selected.length < 9;
  const firstSong = selected[0] ?? null;
  const firstPlaybackKey = firstSong ? getPlaybackKey(firstSong.index, firstSong.game) : null;
  const showTapHint = isPlayableSong && !loading && Boolean(firstSong) && !hasDismissedTapHint;
  const playerDebugEnabled =
    isPlayableSong && (process.env.NODE_ENV !== "production" || searchParams.get("playerDebug") === "1");

  useEffect(() => {
    if (!isPlayableSong) {
      setHasDismissedTapHint(false);
      return;
    }
    setHasDismissedTapHint(false);
  }, [isPlayableSong, pathname]);

  useEffect(() => {
    if (!showTapHint || !firstSong || loading) {
      setTapHintRect(null);
      return;
    }

    const updateRect = () => {
      const node = firstSongCardRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setTapHintRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };

    updateRect();
    window.addEventListener("resize", updateRect, { passive: true });
    window.addEventListener("scroll", updateRect, { passive: true, capture: true });

    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, { capture: true } as EventListenerOptions);
    };
  }, [firstSong, loading, showTapHint]);

  useEffect(() => {
    if (!showTapHint) return;

    const dismiss = () => {
      setHasDismissedTapHint(true);
    };

    window.addEventListener("pointerdown", dismiss, { once: true, passive: true, capture: true });
    window.addEventListener("touchstart", dismiss, { once: true, passive: true, capture: true });
    window.addEventListener("click", dismiss, { once: true, capture: true });

    return () => {
      window.removeEventListener("pointerdown", dismiss, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchstart", dismiss, { capture: true } as EventListenerOptions);
      window.removeEventListener("click", dismiss, { capture: true } as EventListenerOptions);
    };
  }, [showTapHint]);

  useEffect(() => {
    if (!showTapHint || !firstPlaybackKey) return;
    if (activePreviewKey === firstPlaybackKey && isPreviewPlaying) {
      setHasDismissedTapHint(true);
    }
  }, [activePreviewKey, firstPlaybackKey, isPreviewPlaying, showTapHint]);

  function getPlaybackKey(index: number, game: ShareGame) {
    const stableEntryId = typeof game.entryId === "string" ? game.entryId.trim() : "";
    return stableEntryId || `${index}-${String(game.id)}`;
  }

  useEffect(() => {
    if (!isPlayableSong) return;

    const activeKey = activePreviewKeyRef.current;
    if (!activeKey) {
      activeSelectedPositionRef.current = null;
      return;
    }

    const nextPosition = selected.findIndex(({ index, game }) => getPlaybackKey(index, game) === activeKey);
    activeSelectedPositionRef.current = nextPosition >= 0 ? nextPosition : null;
  }, [isPlayableSong, selected]);

  function getAudioElement(slot: 0 | 1) {
    return slot === 0 ? audioPrimaryRef.current : audioSecondaryRef.current;
  }

  function getInactiveAudioSlot() {
    return activeAudioSlotRef.current === 0 ? 1 : 0;
  }

  function updateActiveTrack(playbackKey: string | null, position: number | null) {
    activePreviewKeyRef.current = playbackKey;
    activeSelectedPositionRef.current = position;
    setActivePreviewKey(playbackKey);
  }

  function pushPlayerLog(
    event: string,
    message: string,
    options?: {
      level?: PlayerLogEntry["level"];
      playbackKey?: string | null;
    }
  ) {
    if (!playerDebugEnabled) return;

    const entry: PlayerLogEntry = {
      id: playerLogIdRef.current + 1,
      level: options?.level ?? "info",
      event,
      at: Date.now(),
      playbackKey: options?.playbackKey ?? null,
      message,
    };
    playerLogIdRef.current = entry.id;

    setPlayerLogs((current) => {
      const next = [...current, entry];
      return next.slice(-PLAYER_LOG_LIMIT);
    });
  }

  function beginPlaybackIntent(playbackKey: string, message: string) {
    const nextIntent = playbackIntentRef.current + 1;
    playbackIntentRef.current = nextIntent;
    pushPlayerLog("play:intent", message, { playbackKey });
    return nextIntent;
  }

  function isPlaybackIntentCurrent(intentId: number) {
    return playbackIntentRef.current === intentId;
  }

  function setPlaybackError(playbackKey: string | null, message: string) {
    setErrorPreviewKey(playbackKey);
    if (playbackKey) {
      pushPlayerLog("ui:error-visible", message, { level: "warn", playbackKey });
    }
  }

  function clearTransitionFrame() {
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current);
      transitionFrameRef.current = null;
    }
    transitionInFlightRef.current = false;
  }

  function resetAudioElement(audio: HTMLAudioElement | null) {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1;
  }

  function prefetchNextPreview(position: number) {
    if (!selected.length) return;
    const nextItem = selected[(position + 1) % selected.length];
    if (!nextItem) return;
    void fetchSongPreview(nextItem.game, nextItem.index, {
      suppressErrors: true,
      background: true,
    });
  }

  async function resolveNextPlayableTrack(fromPosition: number) {
    if (!selected.length) return null;

    for (let step = 1; step <= selected.length; step += 1) {
      const nextPosition = (fromPosition + step) % selected.length;
      const nextItem = selected[nextPosition];
      if (!nextItem) continue;

      const preview = await fetchSongPreview(nextItem.game, nextItem.index, {
        suppressErrors: true,
        background: true,
      });
      if (preview?.previewUrl) {
        return {
          position: nextPosition,
          ...nextItem,
          preview,
        };
      }
    }

    return null;
  }

  async function requestSongPreviewOnce(
    game: ShareGame,
    index: number,
    options?: {
      forceFresh?: boolean;
      playbackKey?: string;
    }
  ): Promise<PreviewLookupResult> {
    const playbackKey = options?.playbackKey ?? getPlaybackKey(index, game);
    const timeoutController = new AbortController();
    const timeoutId = window.setTimeout(() => timeoutController.abort(), PREVIEW_FETCH_TIMEOUT_MS);

    try {
      const params = new URLSearchParams({
        title: displayName(game),
        artist: game.name,
      });
      if (options?.forceFresh) {
        params.set("_", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      }

      pushPlayerLog(
        "preview:request:start",
        options?.forceFresh ? "开始强制刷新试听地址" : "开始获取试听地址",
        { playbackKey }
      );

      const response = await fetch(`/api/song/preview?${params.toString()}`, {
        signal: timeoutController.signal,
      });
      const json = (await response.json()) as SongPreviewResponse;

      if (!response.ok || !json.ok) {
        return {
          status: "error",
          preview: null,
          error: json.error || "获取试听失败",
        };
      }

      if (json.preview?.previewUrl) {
        return {
          status: "success",
          preview: json.preview,
        };
      }

      return {
        status: "empty",
        preview: null,
      };
    } catch (error) {
      return {
        status: "error",
        preview: null,
        error: error instanceof Error ? error.message : "获取试听失败",
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function fetchSongPreview(
    game: ShareGame,
    index: number,
    options?: PreviewPlayOptions & {
      background?: boolean;
      intentId?: number;
    }
  ) {
    if (!isPlayableSong) return null;

    const suppressErrors = Boolean(options?.suppressErrors);
    const background = Boolean(options?.background);
    const intentId = options?.intentId;
    const playbackKey = getPlaybackKey(index, game);

    const cachedPreview = previewCacheRef.current.get(playbackKey) ?? null;
    if (cachedPreview?.previewUrl) {
      pushPlayerLog("preview:cache:hit", "命中本地试听缓存", { playbackKey });
      return cachedPreview;
    }

    if (!background) {
      setErrorPreviewKey(null);
      setLoadingPreviewKey(playbackKey);
    }

    try {
      for (let attempt = 0; attempt < PREVIEW_RETRY_DELAYS_MS.length; attempt += 1) {
        const delayMs = PREVIEW_RETRY_DELAYS_MS[attempt];
        const forceFresh = attempt > 0;

        if (delayMs > 0) {
          pushPlayerLog("preview:request:retry", `等待 ${delayMs}ms 后重试试听地址`, {
            level: "warn",
            playbackKey,
          });
          await sleep(delayMs);
        }

        const result = await requestSongPreviewOnce(game, index, {
          forceFresh,
          playbackKey,
        });

        if (typeof intentId === "number" && !isPlaybackIntentCurrent(intentId)) {
          pushPlayerLog("preview:request:stale", "试听地址返回已过期，忽略本次结果", {
            level: "warn",
            playbackKey,
          });
          return null;
        }

        if (result.status === "success") {
          previewCacheRef.current.set(playbackKey, result.preview);
          pushPlayerLog("preview:request:success", "试听地址获取成功", { playbackKey });
          return result.preview;
        }

        if (result.status === "empty") {
          pushPlayerLog(
            "preview:request:empty",
            forceFresh ? "强制刷新后仍未拿到试听地址" : "当前返回为空，准备补查一次",
            {
              level: "warn",
              playbackKey,
            }
          );
          if (attempt === 0) {
            continue;
          }
          break;
        }

        pushPlayerLog(
          "preview:request:error",
          result.error || "试听地址请求失败",
          {
            level: "error",
            playbackKey,
          }
        );
      }

      return null;
    } finally {
      if (!background) {
        setLoadingPreviewKey((current) => (current === playbackKey ? null : current));
      }
      if (!suppressErrors && typeof intentId === "number" && isPlaybackIntentCurrent(intentId)) {
        const currentPreview = previewCacheRef.current.get(playbackKey) ?? null;
        if (!currentPreview?.previewUrl) {
          setPlaybackError(playbackKey, "试听地址获取失败");
        }
      }
    }
  }

  async function startImmediatePlayback(
    game: ShareGame,
    index: number,
    position: number,
    preview: SongPreviewItem,
    intentId: number,
    options?: PreviewPlayOptions
  ) {
    const playbackKey = getPlaybackKey(index, game);
    const suppressErrors = Boolean(options?.suppressErrors);
    if (!isPlaybackIntentCurrent(intentId)) return false;

    const targetAudio = getAudioElement(activeAudioSlotRef.current);
    if (!targetAudio) return false;

    clearTransitionFrame();
    resetAudioElement(getAudioElement(getInactiveAudioSlot()));
    resetAudioElement(targetAudio);

    try {
      targetAudio.src = preview.previewUrl ?? "";
      targetAudio.currentTime = 0;
      targetAudio.volume = 1;
      await targetAudio.play();
      if (!isPlaybackIntentCurrent(intentId)) {
        resetAudioElement(targetAudio);
        pushPlayerLog("play:stale", "播放结果已过期，重置当前音轨", {
          level: "warn",
          playbackKey,
        });
        return false;
      }
      updateActiveTrack(playbackKey, position);
      setActiveProgress(0);
      setIsPreviewPlaying(true);
      setErrorPreviewKey(null);
      pushPlayerLog("play:success", "单轨播放成功", { playbackKey });
      setIsPreviewPlaying(true);
      prefetchNextPreview(position);
      return true;
    } catch {
      if (!suppressErrors) {
        setPlaybackError(playbackKey, "当前歌曲启动播放失败");
      }
      updateActiveTrack(null, null);
      setActiveProgress(0);
      setIsPreviewPlaying(false);
      pushPlayerLog("play:error", "单轨播放失败", {
        level: "error",
        playbackKey,
      });
      return false;
    } finally {
      setLoadingPreviewKey((current) => (current === playbackKey ? null : current));
    }
  }

  async function startCrossfadePlayback(
    game: ShareGame,
    index: number,
    position: number,
    preview: SongPreviewItem,
    intentId: number,
    options?: PreviewPlayOptions & {
      origin?: "manual" | "auto";
    }
  ) {
    const fromSlot = activeAudioSlotRef.current;
    const toSlot = getInactiveAudioSlot();
    const fromAudio = getAudioElement(fromSlot);
    const toAudio = getAudioElement(toSlot);
    const playbackKey = getPlaybackKey(index, game);
    const suppressErrors = Boolean(options?.suppressErrors);
    const origin = options?.origin ?? "manual";
    if (!isPlaybackIntentCurrent(intentId)) return false;

    if (!fromAudio || !toAudio || !preview.previewUrl) {
      transitionInFlightRef.current = false;
      return startImmediatePlayback(game, index, position, preview, intentId, options);
    }

    clearTransitionFrame();
    transitionInFlightRef.current = true;
    resetAudioElement(toAudio);

    try {
      toAudio.src = preview.previewUrl;
      toAudio.currentTime = 0;
      toAudio.volume = 0;
      await toAudio.play();
      await waitForAudioWarmup(toAudio);
      if (!isPlaybackIntentCurrent(intentId)) {
        resetAudioElement(toAudio);
        transitionInFlightRef.current = false;
        pushPlayerLog("track:switch:stale", "切歌请求已过期，取消 crossfade", {
          level: "warn",
          playbackKey,
        });
        return false;
      }
      let hasSwitchedVisibleTrack = false;
      const switchVisibleTrack = () => {
        if (hasSwitchedVisibleTrack) return;
        hasSwitchedVisibleTrack = true;
        activeAudioSlotRef.current = toSlot;
        updateActiveTrack(playbackKey, position);
        setActiveProgress(toAudio.duration > 0 ? clampUnit(toAudio.currentTime / toAudio.duration) : 0);
        setIsPreviewPlaying(true);
        pushPlayerLog(
          "track:switch:crossfade:visible",
          origin === "auto" ? "自动切歌已切换到新歌曲 UI" : "手动切歌已切换到新歌曲 UI",
          { playbackKey }
        );
      };

      if (origin === "manual") {
        switchVisibleTrack();
      }

      setErrorPreviewKey(null);
      pushPlayerLog(
        "track:switch:crossfade:start",
        origin === "auto" ? "开始自动切歌交叉淡入淡出" : "开始手动切歌交叉淡入淡出",
        { playbackKey }
      );
      prefetchNextPreview(position);

      const startTime = performance.now();
      const runFrame = (now: number) => {
        if (!isPlaybackIntentCurrent(intentId)) {
          resetAudioElement(fromAudio);
          resetAudioElement(toAudio);
          transitionFrameRef.current = null;
          transitionInFlightRef.current = false;
          pushPlayerLog("track:switch:crossfade:cancel", "发现更新的切歌请求，取消当前 crossfade", {
            level: "warn",
            playbackKey,
          });
          return;
        }
        const progress = clampUnit((now - startTime) / CROSSFADE_DURATION_MS);
        fromAudio.volume = clampUnit(1 - progress);
        toAudio.volume = clampUnit(progress);

        if (origin === "auto" && progress >= AUTO_CROSSFADE_UI_SWITCH_PROGRESS) {
          switchVisibleTrack();
        }

        if (progress < 1) {
          transitionFrameRef.current = requestAnimationFrame(runFrame);
          return;
        }

        switchVisibleTrack();
        fromAudio.pause();
        fromAudio.currentTime = 0;
        fromAudio.volume = 1;
        toAudio.volume = 1;
        transitionFrameRef.current = null;
        transitionInFlightRef.current = false;
        pushPlayerLog(
          "track:switch:crossfade:complete",
          origin === "auto" ? "自动切歌交叉淡入淡出完成" : "手动切歌交叉淡入淡出完成",
          { playbackKey }
        );
      };

      transitionFrameRef.current = requestAnimationFrame(runFrame);
      return true;
    } catch {
      transitionInFlightRef.current = false;
      resetAudioElement(toAudio);
      if (!suppressErrors) {
        setPlaybackError(playbackKey, "交叉淡入淡出切歌失败");
      }
      pushPlayerLog("track:switch:error", "交叉淡入淡出启动失败", {
        level: "error",
        playbackKey,
      });
      return false;
    } finally {
      setLoadingPreviewKey((current) => (current === playbackKey ? null : current));
    }
  }

  async function playSongPreview(
    game: ShareGame,
    index: number,
    position: number,
    options?: PreviewPlayOptions
  ) {
    if (!isPlayableSong) return false;

    const suppressErrors = Boolean(options?.suppressErrors);
    const playbackKey = getPlaybackKey(index, game);
    const intentId = beginPlaybackIntent(playbackKey, `请求播放第 ${position + 1} 首`);
    const audio = getAudioElement(activeAudioSlotRef.current);
    if (!audio) return false;

    if (activePreviewKey === playbackKey && audio.src) {
      try {
        if (!audio.paused) {
          pauseSongPreview();
          pushPlayerLog("play:pause", "用户暂停当前歌曲", { playbackKey });
          return true;
        }

        await audio.play();
        if (!isPlaybackIntentCurrent(intentId)) {
          audio.pause();
          return false;
        }
        setErrorPreviewKey(null);
        setIsPreviewPlaying(true);
        pushPlayerLog("play:resume", "恢复播放当前歌曲", { playbackKey });
        return true;
      } catch {
        if (!suppressErrors) {
          setPlaybackError(playbackKey, "恢复播放失败");
        }
        setIsPreviewPlaying(false);
        pushPlayerLog("play:error", "恢复播放失败", {
          level: "error",
          playbackKey,
        });
        return false;
      }
    }

    if (transitionInFlightRef.current) {
      pushPlayerLog("track:switch:interrupt", "用户在 crossfade 期间切歌，先结束旧过渡并切到新目标", {
        level: "warn",
        playbackKey,
      });
      clearTransitionFrame();
      const fadingOutAudio = getAudioElement(getInactiveAudioSlot());
      const activeAudio = getAudioElement(activeAudioSlotRef.current);
      resetAudioElement(fadingOutAudio);
      if (activeAudio) {
        activeAudio.volume = 1;
      }
      setErrorPreviewKey(null);
    }

    const preview = await fetchSongPreview(game, index, {
      ...options,
      intentId,
    });

    if (!preview?.previewUrl) {
      if (!suppressErrors) {
        setPlaybackError(playbackKey, "当前歌曲暂时无法试听");
      }
      return false;
    }

    if (!isPlaybackIntentCurrent(intentId)) {
      pushPlayerLog("play:stale", "当前点击已被更新的播放请求替代", {
        level: "warn",
        playbackKey,
      });
      return false;
    }

    const liveAudio = getAudioElement(activeAudioSlotRef.current);
    if (liveAudio?.src && !liveAudio.paused && activePreviewKeyRef.current) {
      pushPlayerLog("track:switch:crossfade:manual", "手动切歌使用交叉淡入淡出", {
        playbackKey,
      });
      return startCrossfadePlayback(game, index, position, preview, intentId, {
        ...options,
        origin: "manual",
      });
    }
    return startImmediatePlayback(game, index, position, preview, intentId, options);
  }

  function pauseSongPreview() {
    clearTransitionFrame();
    const activeSlot = activeAudioSlotRef.current;
    const activeAudio = getAudioElement(activeSlot);
    const inactiveAudio = getAudioElement(getInactiveAudioSlot());
    activeAudio?.pause();
    if (inactiveAudio) {
      inactiveAudio.pause();
      inactiveAudio.currentTime = 0;
      inactiveAudio.volume = 1;
    }
    setIsPreviewPlaying(false);
    pushPlayerLog("play:pause", "暂停当前播放", {
      playbackKey: activePreviewKeyRef.current,
    });
  }

  async function advancePlaylist(mode: "crossfade" | "immediate") {
    const currentPosition = activeSelectedPositionRef.current;
    if (currentPosition === null || !selected.length || transitionInFlightRef.current) {
      return false;
    }

    transitionInFlightRef.current = true;
    const nextTrack = await resolveNextPlayableTrack(currentPosition);
    const intentId = nextTrack
      ? beginPlaybackIntent(getPlaybackKey(nextTrack.index, nextTrack.game), `自动切换到第 ${nextTrack.position + 1} 首`)
      : playbackIntentRef.current;

    if (!nextTrack) {
      transitionInFlightRef.current = false;
      pushPlayerLog("recover:advance-next", "未找到下一首可播歌曲，停止自动切歌", {
        level: "warn",
        playbackKey: activePreviewKeyRef.current,
      });
      return false;
    }

    if (mode === "immediate") {
      transitionInFlightRef.current = false;
      return startImmediatePlayback(nextTrack.game, nextTrack.index, nextTrack.position, nextTrack.preview, intentId, {
        suppressErrors: true,
      });
    }

    return startCrossfadePlayback(nextTrack.game, nextTrack.index, nextTrack.position, nextTrack.preview, intentId, {
      suppressErrors: true,
      origin: "auto",
    });
  }

  function handleAudioTimeUpdate(slot: 0 | 1, event: React.SyntheticEvent<HTMLAudioElement>) {
    if (slot !== activeAudioSlotRef.current) return;

    const audio = event.currentTarget;
    const nextProgress = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
    setActiveProgress(nextProgress);

    if (
      audio.duration > 0 &&
      !audio.paused &&
      !audio.ended &&
      selected.length > 0 &&
      !transitionInFlightRef.current &&
      audio.duration - audio.currentTime <= CROSSFADE_TRIGGER_SECONDS
    ) {
      void advancePlaylist("crossfade");
    }
  }

  function handleAudioPlay(slot: 0 | 1) {
    if (slot !== activeAudioSlotRef.current) return;
    setIsPreviewPlaying(true);
    pushPlayerLog("audio:play", "音轨进入播放态", {
      playbackKey: activePreviewKeyRef.current,
    });
  }

  function handleAudioPause(slot: 0 | 1, event: React.SyntheticEvent<HTMLAudioElement>) {
    if (slot !== activeAudioSlotRef.current) return;
    if (event.currentTarget.ended) return;
    setIsPreviewPlaying(false);
    setActiveProgress(
      event.currentTarget.duration > 0
        ? event.currentTarget.currentTime / event.currentTarget.duration
        : 0
    );
    pushPlayerLog("audio:pause", "音轨进入暂停态", {
      playbackKey: activePreviewKeyRef.current,
    });
  }

  function handleAudioEnded(slot: 0 | 1) {
    if (slot !== activeAudioSlotRef.current || transitionInFlightRef.current) return;
    setActiveProgress(0);
    setIsPreviewPlaying(false);
    pushPlayerLog("audio:ended", "当前歌曲播放结束，准备切下一首", {
      playbackKey: activePreviewKeyRef.current,
    });
    void advancePlaylist("immediate");
  }

  useEffect(() => {
    const primaryAudio = audioPrimaryRef.current;
    const secondaryAudio = audioSecondaryRef.current;

    return () => {
      clearTransitionFrame();
      resetAudioElement(primaryAudio);
      resetAudioElement(secondaryAudio);
    };
  }, []);

  useEffect(() => {
    if (!playerDebugEnabled || !debugPanelOpen) return;

    const node = debugListRef.current;
    if (!node) return;

    const frameId = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [debugPanelOpen, playerDebugEnabled, playerLogs]);

  return (
    <>
      <section className="w-full">
        <div className="music-panel rounded-[2rem] p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black text-foreground">{title}</h2>
            <span className="text-xs font-semibold text-muted-foreground">{selected.length} {countLabel}</span>
          </div>

          <div className="music-divider mb-5" />

          <div className="space-y-4">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">正在加载...</p>
            ) : null}

            {!loading && selected.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
            ) : null}

            {!loading ? (
              <DragDropProvider
                plugins={[Feedback, AutoScroller, Cursor]}
                onBeforeDragStart={() => {
                  suppressCardClickUntilRef.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;
                  setHasDismissedTapHint(true);
                }}
                onDragEnd={(event) => {
                  suppressCardClickUntilRef.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;
                  const { source, canceled } = event.operation;
                  if (!source || canceled || !isSortable(source) || !canReorder) return;
                  const from = source.initialIndex;
                  const to = source.index;
                  if (from === to) return;
                  onReorderSong?.(from, to);
                }}
              >
                {selected.map(({ index, game }, position) => {
                  const playbackKey = getPlaybackKey(index, game);
                  const isCurrent = activePreviewKey === playbackKey;
                  const isActive = isCurrent && isPreviewPlaying;
                  const hasPreviewError = errorPreviewKey === playbackKey;
                  const showArtist = Boolean(game.localizedName && game.localizedName.trim() !== game.name);
                  const displayPosition = position + 1;
                  const rowId = game.entryId?.trim() || String(game.id);
                  const cardMotionClass = canReorder
                    ? "transition-[background-color,border-color,box-shadow,opacity] duration-150"
                    : "transition-all duration-200 hover:-translate-y-0.5";

                  return (
                    <SortableSongRow
                      key={rowId}
                      id={rowId}
                      index={position}
                      disabled={!canReorder}
                      transition={isEditor ? null : undefined}
                    >
                      {({ ref, isDragSource }) => (
                        <article
                          ref={(node) => {
                            ref(node);
                            firstSongCardRef.current = position === 0 ? node as HTMLElement | null : firstSongCardRef.current === node ? null : firstSongCardRef.current;
                          }}
                          data-testid={`selected-song-card-${displayPosition}`}
                          className={`music-subpanel ${isCurrent ? "music-playback-card-active" : ""} flex flex-col gap-3 rounded-[1.75rem] p-5 ${cardMotionClass} ${
                            isPlayableSong ? "cursor-pointer" : canReorder ? "cursor-grab active:cursor-grabbing" : ""
                          } ${isDragSource ? "opacity-60 ring-2 ring-orange-300/80" : ""} ${canReorder ? "select-none" : ""}`}
                          onClick={
                            isPlayableSong
                              ? () => {
                                  if (Date.now() < suppressCardClickUntilRef.current) return;
                                  if (position === 0) {
                                    setHasDismissedTapHint(true);
                                  }
                                  void playSongPreview(game, index, position);
                                }
                              : undefined
                          }
                          onKeyDown={
                            isPlayableSong
                              ? (event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    void playSongPreview(game, index, position);
                                  }
                                }
                              : undefined
                          }
                          tabIndex={isPlayableSong ? 0 : undefined}
                          aria-label={isPlayableSong ? `试听第 ${displayPosition} 首歌` : undefined}
                        >
                          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-foreground/6 text-base font-black text-foreground dark:bg-white/6">
                              {displayPosition}
                            </div>

                            <div className="w-16 flex-shrink-0 overflow-hidden rounded-[1.1rem] border border-border/70 bg-muted shadow-sm sm:w-[4.75rem]">
                              {game.cover ? (
                                <Image
                                  src={game.cover}
                                  alt={game.name}
                                  width={76}
                                  height={76}
                                  unoptimized
                                  className="aspect-square h-auto w-full object-cover"
                                />
                              ) : (
                                <div className="flex aspect-square items-center justify-center text-[11px] text-muted-foreground">
                                  无图
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <h3 className="mb-1 whitespace-normal break-words text-base font-bold text-card-foreground sm:text-lg">
                                {displayName(game)}
                                {game.releaseYear ? ` (${game.releaseYear})` : ""}
                              </h3>
                              {showArtist ? (
                                <div className="mt-2 flex items-center gap-2">
                                  <p className="whitespace-normal break-words text-xs text-muted-foreground sm:text-sm">
                                    {game.name}
                                  </p>
                                  {isPlayableSong ? (
                                    <div
                                      className={`music-equalizer ${isActive ? "is-playing" : ""}`}
                                      aria-hidden="true"
                                    >
                                      <span className="music-equalizer-bar" />
                                      <span className="music-equalizer-bar" />
                                      <span className="music-equalizer-bar" />
                                      <span className="music-equalizer-bar" />
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-col items-center gap-2 self-start">
                              {isPlayableSong ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSearchGame(game);
                                  }}
                                  className="rounded-full border border-border/70 bg-card/70 p-2 text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-accent/80 hover:text-accent-foreground"
                                  aria-label={`搜索第 ${displayPosition} 首歌的原曲平台`}
                                  title={`搜索第 ${displayPosition} 首歌的原曲平台`}
                                >
                                  <Headphones className="h-4 w-4" />
                                </button>
                              ) : null}

                              {isEditor ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onEditSong?.(index);
                                    }}
                                    aria-label={`替换第 ${displayPosition} 首${subjectLabel}`}
                                    title={`替换第 ${displayPosition} 首${subjectLabel}`}
                                    className="rounded-full border border-border/70 bg-card/70 p-2 text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-accent/80 hover:text-accent-foreground"
                                  >
                                    <Search className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onRemoveSong?.(index);
                                    }}
                                    aria-label={`移除第 ${displayPosition} 首${subjectLabel}`}
                                    title={`移除第 ${displayPosition} 首${subjectLabel}`}
                                    className="rounded-full border border-border/70 bg-card/70 p-2 text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-accent/80 hover:text-accent-foreground"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>

                          {isPlayableSong ? (
                            <div className="mt-1">
                              <div className="music-playback-progress">
                                <div
                                  className="music-playback-progress-bar"
                                  style={{ width: `${isCurrent ? Math.max(activeProgress * 100, 0) : 0}%` }}
                                />
                              </div>
                              {hasPreviewError ? (
                                <p className="mt-2 text-[11px] text-muted-foreground">暂时无法试听</p>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      )}
                    </SortableSongRow>
                  );
                })}
              </DragDropProvider>
            ) : null}

            {canAddMore ? (
              <button
                type="button"
                onClick={onAddSong}
                className="music-subpanel flex w-full items-center justify-center gap-3 rounded-[1.75rem] border border-dashed border-border/80 p-5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-card/70">
                  <Plus className="h-5 w-5" />
                </span>
                <span>添加歌曲</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>
      {isPlayableSong ? (
        <>
          {showTapHint && tapHintRect ? (
            <div className="music-wechat-hint-layer" aria-hidden="true">
              <div
                className="music-wechat-hint-spotlight"
                style={{
                  top: `${tapHintRect.top}px`,
                  left: `${tapHintRect.left}px`,
                  width: `${tapHintRect.width}px`,
                  height: `${tapHintRect.height}px`,
                }}
              />
              <div
                className="music-wechat-hint-bubble"
                style={{
                  top: `${Math.max(14, tapHintRect.top - 58)}px`,
                  left: `${Math.min(
                    Math.max(14, tapHintRect.left + tapHintRect.width - 182),
                    Math.max(14, (typeof window !== "undefined" ? window.innerWidth : 320) - 210)
                  )}px`,
                }}
              >
                <ArrowDownRight className="h-4 w-4" />
                <span>点击试听</span>
              </div>
            </div>
          ) : null}
          <audio
            ref={audioPrimaryRef}
            preload="auto"
            playsInline
            className="hidden"
            onTimeUpdate={(event) => handleAudioTimeUpdate(0, event)}
            onPlay={() => handleAudioPlay(0)}
            onPause={(event) => handleAudioPause(0, event)}
            onEnded={() => handleAudioEnded(0)}
          />
          <audio
            ref={audioSecondaryRef}
            preload="auto"
            playsInline
            className="hidden"
            onTimeUpdate={(event) => handleAudioTimeUpdate(1, event)}
            onPlay={() => handleAudioPlay(1)}
            onPause={(event) => handleAudioPause(1, event)}
            onEnded={() => handleAudioEnded(1)}
          />
          <SongPlatformSearchDialog
            open={Boolean(searchGame)}
            onOpenChange={(open) => {
              if (!open) {
                setSearchGame(null);
              }
            }}
            game={searchGame}
            onBeforePlatformOpen={pauseSongPreview}
          />
          {playerDebugEnabled ? (
            <div className="music-player-debug-shell">
              <button
                type="button"
                className="music-player-debug-toggle"
                onClick={() => setDebugPanelOpen((current) => !current)}
              >
                日志
              </button>
              {debugPanelOpen ? (
                <div className="music-player-debug-panel">
                  <div className="music-player-debug-header">
                    <strong>播放器日志</strong>
                    <div className="music-player-debug-actions">
                      <button
                        type="button"
                        onClick={async () => {
                          const text = playerLogs
                            .map((entry) => {
                              const timestamp = new Date(entry.at).toLocaleTimeString("zh-CN", {
                                hour12: false,
                              });
                              const keyText = entry.playbackKey ? ` [${entry.playbackKey}]` : "";
                              return `${timestamp} ${entry.level.toUpperCase()} ${entry.event}${keyText} ${entry.message}`;
                            })
                            .join("\n");
                          await navigator.clipboard.writeText(text);
                        }}
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerLogs([])}
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div ref={debugListRef} className="music-player-debug-list">
                    {playerLogs.length === 0 ? (
                      <p className="music-player-debug-empty">暂无日志</p>
                    ) : (
                      playerLogs.map((entry) => (
                        <div key={entry.id} className={`music-player-debug-item is-${entry.level}`}>
                          <div className="music-player-debug-meta">
                            <span>{new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                            <span>{entry.event}</span>
                            {entry.playbackKey ? <span>{entry.playbackKey}</span> : null}
                          </div>
                          <p>{entry.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
