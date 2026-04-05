"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShareGame } from "@/lib/share/types";
import {
  SONG_POSTER_CANVAS_HEIGHT,
  SONG_POSTER_CANVAS_WIDTH,
  buildDefaultVisibleCoverEntryIds,
  downloadBlob,
  generateEnhancedShareImageBlob,
  getShareGameEntryId,
  getSongPosterCoverRegions,
  type PosterCoverRegion,
} from "@/utils/image/exportShareImage";
import { SubjectKind } from "@/lib/subject-kind";

type NoticeKind = "success" | "error" | "info";

interface ShareImagePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: SubjectKind;
  shareId: string;
  title: string;
  games: Array<ShareGame | null>;
  creatorName?: string | null;
  shareMessage?: string | null;
  initialPreviewUrl?: string | null;
  initialPreviewBlob?: Blob | null;
  onNotice: (kind: NoticeKind, message: string) => void;
}

type PreviewSnapshot = {
  kind: SubjectKind;
  shareId: string;
  title: string;
  games: Array<ShareGame | null>;
  creatorName?: string | null;
  shareMessage?: string | null;
};

type DragSession = {
  pointerId: number;
  pointerType: string;
  originIndex: number;
  startX: number;
  startY: number;
  ghostWidth: number;
  ghostHeight: number;
  started: boolean;
  longPressTimer: number | null;
};

type DragGhostPosition = {
  x: number;
  y: number;
};

type BoardTilt = {
  rotateX: number;
  rotateY: number;
  translateX: number;
  translateY: number;
};

type VirtualCoverSlot = {
  index: number;
  entryId: string;
  title: string;
  cover: string | null;
  region: PosterCoverRegion;
  bounds: RegionBounds;
};

type RegionBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const TOUCH_DRAG_DELAY_MS = 220;
const TOUCH_MOVE_TOLERANCE = 10;
const MOUSE_DRAG_DISTANCE = 4;
const DEFAULT_BOARD_TILT: BoardTilt = {
  rotateX: 15,
  rotateY: -15,
  translateX: 0,
  translateY: 0,
};
function buildFileName(kind: SubjectKind, title: string) {
  void kind;
  return `${title}.png`;
}

function cloneGames(games: Array<ShareGame | null>) {
  return games.map((game) => (game ? { ...game } : null));
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("FileReader unavailable"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Invalid data URL result"));
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

function revokePreviewObjectUrl(previewUrlRef: MutableRefObject<string | null>) {
  if (!previewUrlRef.current) return;
  URL.revokeObjectURL(previewUrlRef.current);
  previewUrlRef.current = null;
}

function areEntryIdsEqual(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function updateVisibleCoverEntryIds(entryIds: string[], fromIndex: number, toIndex: number) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= entryIds.length ||
    toIndex >= entryIds.length ||
    fromIndex === toIndex
  ) {
    return entryIds;
  }

  const next = [...entryIds];
  if (fromIndex === 0 || toIndex === 0) {
    const targetIndex = fromIndex === 0 ? toIndex : fromIndex;
    next[0] = next[targetIndex];
    return next;
  }

  [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
  return next;
}

function clearLongPressTimer(session: DragSession | null) {
  if (!session || session.longPressTimer === null) return;
  window.clearTimeout(session.longPressTimer);
  session.longPressTimer = null;
}

function getRegionBounds(region: PosterCoverRegion): RegionBounds {
  if (region.kind === "hero") {
    return {
      minX: region.x,
      maxX: region.x + region.width,
      minY: region.y,
      maxY: region.y + region.height,
    };
  }

  const xs = region.points.map((point) => point.x);
  const ys = region.points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function displayCoverTitle(game: ShareGame) {
  const title = game.localizedName?.trim() || game.name;
  return game.releaseYear ? `${title} (${game.releaseYear})` : title;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getRegionSize(bounds: RegionBounds) {
  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function toCssClipPath(region: PosterCoverRegion, bounds: RegionBounds) {
  if (region.kind === "hero") return undefined;
  const size = getRegionSize(bounds);
  const polygon = region.points
    .map((point) => {
      const x = ((point.x - bounds.minX) / size.width) * 100;
      const y = ((point.y - bounds.minY) / size.height) * 100;
      return `${x}% ${y}%`;
    })
    .join(", ");
  return `polygon(${polygon})`;
}

function toHeroBorderRadius(region: PosterCoverRegion) {
  if (region.kind !== "hero") return undefined;
  return `${(region.radius / region.width) * 100}%`;
}

function getSpreadStyle(bounds: RegionBounds) {
  const size = getRegionSize(bounds);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const normalizedX = (centerX - SONG_POSTER_CANVAS_WIDTH / 2) / SONG_POSTER_CANVAS_WIDTH;
  const normalizedY = (centerY - SONG_POSTER_CANVAS_HEIGHT / 2) / SONG_POSTER_CANVAS_HEIGHT;
  const insetX = Math.min(size.width * 0.06, 22);
  const insetY = Math.min(size.height * 0.06, 22);

  return {
    insetX,
    insetY,
    offsetX: normalizedX * 18,
    offsetY: normalizedY * 24,
  };
}

function pointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>
) {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          ((previousPoint.y - currentPoint.y) || Number.EPSILON) +
          currentPoint.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function toVirtualCoverSlots(
  regions: PosterCoverRegion[],
  visibleCoverEntryIds: readonly string[],
  games: Array<ShareGame | null>
) {
  const selectedGames = games.filter((game): game is ShareGame => Boolean(game));
  const gameEntries = selectedGames.map((game, index) => ({
    entryId: getShareGameEntryId(game, index),
    title: displayCoverTitle(game),
    cover: game.cover || null,
  }));
  const gameByEntryId = new Map(gameEntries.map((entry) => [entry.entryId, entry] as const));

  return regions.flatMap((region) => {
    const entryId = visibleCoverEntryIds[region.index];
    const entry = entryId ? gameByEntryId.get(entryId) : null;
    if (!entry) return [];

    const bounds = getRegionBounds(region);
    return [
      {
        index: region.index,
        entryId: entry.entryId,
        title: entry.title,
        cover: entry.cover,
        region,
        bounds,
      },
    ];
  });
}

export function ShareImagePreviewDialog({
  open,
  onOpenChange,
  kind,
  shareId,
  title,
  games,
  creatorName,
  shareMessage,
  initialPreviewUrl = null,
  initialPreviewBlob = null,
  onNotice,
}: ShareImagePreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [isWeChatBrowser, setIsWeChatBrowser] = useState(false);
  const [isHorizontalSplitLayout, setIsHorizontalSplitLayout] = useState(false);
  const [visibleCoverEntryIds, setVisibleCoverEntryIds] = useState<string[]>([]);
  const [, setActiveRegionIndex] = useState(0);
  const [draggingRegionIndex, setDraggingRegionIndex] = useState<number | null>(null);
  const [hoverRegionIndex, setHoverRegionIndex] = useState<number | null>(null);
  const [dragGhostPosition, setDragGhostPosition] = useState<DragGhostPosition | null>(null);
  const [boardTilt, setBoardTilt] = useState<BoardTilt>(DEFAULT_BOARD_TILT);
  const requestIdRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const previewAvailableRef = useRef(false);
  const virtualPosterRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);

  const selectedGames = useMemo(
    () => snapshot?.games.filter((game): game is ShareGame => Boolean(game)) || [],
    [snapshot]
  );
  const defaultVisibleCoverEntryIds = useMemo(
    () => (snapshot ? buildDefaultVisibleCoverEntryIds(snapshot.games) : []),
    [snapshot]
  );
  const coverRegions = useMemo(
    () => (selectedGames.length > 0 ? getSongPosterCoverRegions(selectedGames.length) : []),
    [selectedGames]
  );
  const heroCoverCandidates = useMemo(
    () =>
      selectedGames.map((game, index) => ({
        entryId: getShareGameEntryId(game, index),
        title: displayCoverTitle(game),
        cover: game.cover || null,
      })),
    [selectedGames]
  );
  const virtualCoverSlots = useMemo(
    (): VirtualCoverSlot[] => toVirtualCoverSlots(coverRegions, visibleCoverEntryIds, snapshot?.games || []),
    [coverRegions, snapshot?.games, visibleCoverEntryIds]
  );
  const renderedVirtualCoverSlots = useMemo(
    () =>
      [...virtualCoverSlots].sort((left, right) => {
        if (left.index === 0 && right.index !== 0) return 1;
        if (left.index !== 0 && right.index === 0) return -1;
        return left.index - right.index;
      }),
    [virtualCoverSlots]
  );
  const canEditCoverRegions = selectedGames.length >= 2 && visibleCoverEntryIds.length === coverRegions.length;
  const showPreviewOnlyLayout = selectedGames.length < 2;
  const backgroundVirtualSlots = useMemo(
    () => renderedVirtualCoverSlots.filter((slot) => slot.index !== 0),
    [renderedVirtualCoverSlots]
  );
  const heroCandidateLayout = useMemo(() => {
    const count = heroCoverCandidates.length;

    if (count >= 7) {
      return {
        columns: 2,
        rows: 5,
        gridWidth: "5.7rem",
        columnGap: "0.38rem",
        rowGap: "0.34rem",
        buttonSize: "2.26rem",
        posterMaxWidth: "calc(100% - 9.4rem)",
      };
    }

    if (count >= 5) {
      return {
        columns: 1,
        rows: count,
        gridWidth: "4.7rem",
        columnGap: "0rem",
        rowGap: "0.45rem",
        buttonSize: "2.92rem",
        posterMaxWidth: "calc(100% - 8.2rem)",
      };
    }

    return {
      columns: 1,
      rows: 4,
      gridWidth: "4.7rem",
      columnGap: "0rem",
      rowGap: "0.72rem",
      buttonSize: "2.92rem",
      posterMaxWidth: "calc(100% - 8.2rem)",
    };
  }, [heroCoverCandidates.length]);
  const heroCandidateColumns = useMemo(() => {
    if (heroCoverCandidates.length >= 7) {
      return [heroCoverCandidates.slice(0, 5), heroCoverCandidates.slice(5)];
    }
    return [heroCoverCandidates];
  }, [heroCoverCandidates]);
  const previewInstruction = isWeChatBrowser
    ? isHorizontalSplitLayout
      ? "长按预览图保存到手机(电脑右键复制图片)"
      : "长按预览图保存到手机"
    : null;
  const previewOnlyInstruction = "长按预览图保存到手机";
  const draggedSlot = draggingRegionIndex === null
    ? null
    : virtualCoverSlots.find((slot) => slot.index === draggingRegionIndex) || null;

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      clearLongPressTimer(dragSessionRef.current);
      revokePreviewObjectUrl(previewUrlRef);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      setIsWeChatBrowser(false);
      return;
    }
    setIsWeChatBrowser(/MicroMessenger/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 640px)");
    const updateLayout = (event?: MediaQueryListEvent) => {
      setIsHorizontalSplitLayout(event ? event.matches : mediaQuery.matches);
    };

    updateLayout();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateLayout);
      return () => mediaQuery.removeEventListener("change", updateLayout);
    }

    mediaQuery.addListener(updateLayout);
    return () => mediaQuery.removeListener(updateLayout);
  }, []);

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      clearLongPressTimer(dragSessionRef.current);
      dragSessionRef.current = null;
      setLoading(false);
      setSnapshot(null);
      setPreviewBlob(null);
      setPreviewError("");
      setVisibleCoverEntryIds([]);
      setActiveRegionIndex(0);
      setDraggingRegionIndex(null);
      setHoverRegionIndex(null);
      setDragGhostPosition(null);
      setBoardTilt(DEFAULT_BOARD_TILT);
      revokePreviewObjectUrl(previewUrlRef);
      setPreviewUrl(null);
      return;
    }

    const nextSnapshot = {
      kind,
      shareId,
      title,
      games: cloneGames(games),
      creatorName,
      shareMessage,
    };

    setSnapshot(nextSnapshot);
    setPreviewBlob(initialPreviewBlob);
    setPreviewError("");
    setPreviewUrl(initialPreviewUrl);
    setVisibleCoverEntryIds(buildDefaultVisibleCoverEntryIds(nextSnapshot.games));
    setActiveRegionIndex(0);
    setDraggingRegionIndex(null);
    setHoverRegionIndex(null);
    setDragGhostPosition(null);
    setBoardTilt(DEFAULT_BOARD_TILT);
  }, [
    open,
    kind,
    shareId,
    title,
    games,
    creatorName,
    shareMessage,
    initialPreviewUrl,
    initialPreviewBlob,
  ]);

  useEffect(() => {
    previewAvailableRef.current = Boolean(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!open || !snapshot) return;
    if (
      initialPreviewUrl &&
      initialPreviewBlob &&
      areEntryIdsEqual(visibleCoverEntryIds, defaultVisibleCoverEntryIds)
    ) {
      setLoading(false);
      setPreviewError("");
      setPreviewBlob(initialPreviewBlob);
      setPreviewUrl(() => {
        revokePreviewObjectUrl(previewUrlRef);
        previewUrlRef.current = null;
        return initialPreviewUrl;
      });
      return;
    }
    if (visibleCoverEntryIds.length === 0) return;

    const currentSnapshot = snapshot;
    const currentVisibleCoverEntryIds = [...visibleCoverEntryIds];
    const hadPreview = previewAvailableRef.current;
    const requestId = ++requestIdRef.current;

    async function loadPreview() {
      setLoading(true);
      setPreviewError("");
      try {
        const blob = await generateEnhancedShareImageBlob({
          kind: currentSnapshot.kind,
          shareId: currentSnapshot.shareId,
          title: currentSnapshot.title,
          games: currentSnapshot.games,
          creatorName: currentSnapshot.creatorName,
          shareMessage: currentSnapshot.shareMessage,
          showNames: true,
          visibleCoverEntryIds: currentVisibleCoverEntryIds,
        });
        const nextUrl = isWeChatBrowser ? await blobToDataUrl(blob) : URL.createObjectURL(blob);

        if (requestId !== requestIdRef.current) {
          if (!isWeChatBrowser) {
            URL.revokeObjectURL(nextUrl);
          }
          return;
        }
        setPreviewBlob(blob);
        setPreviewUrl(() => {
          revokePreviewObjectUrl(previewUrlRef);
          previewUrlRef.current = isWeChatBrowser ? null : nextUrl;
          return nextUrl;
        });
      } catch {
        if (requestId !== requestIdRef.current) return;
        if (!hadPreview) {
          setPreviewBlob(null);
          setPreviewError("图片生成失败，请稍后重试");
          revokePreviewObjectUrl(previewUrlRef);
          setPreviewUrl(null);
        } else {
          onNotice("error", "分享图片更新失败，请稍后重试");
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }

    loadPreview();
  }, [
    open,
    snapshot,
    isWeChatBrowser,
    initialPreviewUrl,
    initialPreviewBlob,
    visibleCoverEntryIds,
    defaultVisibleCoverEntryIds,
    onNotice,
  ]);

  function releasePointerCapture(pointerId: number) {
    const poster = virtualPosterRef.current;
    if (!poster || !poster.hasPointerCapture(pointerId)) return;
    poster.releasePointerCapture(pointerId);
  }

  function resetDragState(pointerId?: number) {
    const nextPointerId = pointerId ?? dragSessionRef.current?.pointerId;
    if (nextPointerId !== undefined) {
      releasePointerCapture(nextPointerId);
    }
    clearLongPressTimer(dragSessionRef.current);
    dragSessionRef.current = null;
    setDraggingRegionIndex(null);
    setHoverRegionIndex(null);
    setDragGhostPosition(null);
    setBoardTilt(DEFAULT_BOARD_TILT);
  }

  function updateDragGhostPosition(clientX: number, clientY: number) {
    const poster = virtualPosterRef.current;
    if (!poster) return;
    const rect = poster.getBoundingClientRect();
    setDragGhostPosition({
      x: clamp(clientX - rect.left, 0, rect.width),
      y: clamp(clientY - rect.top, 0, rect.height),
    });
  }

  function updateBoardTiltFromDragDelta(deltaX: number, deltaY: number) {
    const poster = virtualPosterRef.current;
    if (!poster) return;
    const rect = poster.getBoundingClientRect();
    const normalizedX = deltaX / Math.max(rect.width, 1);
    const normalizedY = deltaY / Math.max(rect.height, 1);

    setBoardTilt({
      rotateX: DEFAULT_BOARD_TILT.rotateX + clamp(-normalizedY * 36, -15, 15),
      rotateY: DEFAULT_BOARD_TILT.rotateY + clamp(normalizedX * 44, -18, 18),
      translateX: clamp(normalizedX * 24, -10, 10),
      translateY: clamp(normalizedY * 24, -10, 10),
    });
  }

  function startDragging(session: DragSession) {
    if (session.started) return;
    session.started = true;
    clearLongPressTimer(session);
    virtualPosterRef.current?.setPointerCapture(session.pointerId);
    setDraggingRegionIndex(session.originIndex);
    setHoverRegionIndex(session.originIndex);
    updateDragGhostPosition(session.startX, session.startY);
    setBoardTilt(DEFAULT_BOARD_TILT);
  }

  function findRegionTargetFromPoint(clientX: number, clientY: number) {
    const poster = virtualPosterRef.current;
    if (!poster) return null;

    const candidates = backgroundVirtualSlots.flatMap((slot) => {
      const element = poster.querySelector<HTMLElement>(
        `[data-share-image-hit-slot-index="${slot.index}"]`
      );
      if (!element) return [];

      const rect = element.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return [];
      }

      const size = getRegionSize(slot.bounds);
      const polygon = slot.region.kind === "background"
        ? slot.region.points.map((regionPoint) => ({
            x: rect.left + ((regionPoint.x - slot.bounds.minX) / size.width) * rect.width,
            y: rect.top + ((regionPoint.y - slot.bounds.minY) / size.height) * rect.height,
          }))
        : null;

      if (polygon && !pointInPolygon({ x: clientX, y: clientY }, polygon)) {
        return [];
      }

      return [
        {
          index: slot.index,
          rect,
          area: rect.width * rect.height,
        },
      ];
    });

    if (candidates.length === 0) return null;
    candidates.sort((left, right) => left.area - right.area);
    return candidates[0];
  }

  function findRegionIndexFromPoint(clientX: number, clientY: number) {
    return findRegionTargetFromPoint(clientX, clientY)?.index ?? null;
  }

  function beginDragSession(
    index: number,
    pointerId: number,
    pointerType: string,
    clientX: number,
    clientY: number,
    slotRect: DOMRect
  ) {
    if (!canEditCoverRegions) return;

    resetDragState();
    setActiveRegionIndex(index);

    const session: DragSession = {
      pointerId,
      pointerType: pointerType || "mouse",
      originIndex: index,
      startX: clientX,
      startY: clientY,
      ghostWidth: slotRect.width,
      ghostHeight: slotRect.height,
      started: false,
      longPressTimer: null,
    };

    dragSessionRef.current = session;

    if (session.pointerType === "touch") {
      session.longPressTimer = window.setTimeout(() => {
        if (dragSessionRef.current !== session) return;
        startDragging(session);
      }, TOUCH_DRAG_DELAY_MS);
      return;
    }

    virtualPosterRef.current?.setPointerCapture(pointerId);
  }

  function handleVirtualPosterPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditCoverRegions) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const target = findRegionTargetFromPoint(event.clientX, event.clientY);
    if (!target) return;

    beginDragSession(
      target.index,
      event.pointerId,
      event.pointerType,
      event.clientX,
      event.clientY,
      target.rect
    );
  }

  function handleVirtualPosterPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    const distance = Math.hypot(deltaX, deltaY);

    if (!session.started) {
      if (session.pointerType === "touch") {
        if (distance > TOUCH_MOVE_TOLERANCE) {
          resetDragState();
        }
        return;
      }

      if (distance < MOUSE_DRAG_DISTANCE) {
        return;
      }

      startDragging(session);
    }

    event.preventDefault();
    updateDragGhostPosition(event.clientX, event.clientY);
    updateBoardTiltFromDragDelta(deltaX, deltaY);
    setHoverRegionIndex(findRegionIndexFromPoint(event.clientX, event.clientY));
  }

  function handleVirtualPosterPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const targetIndex = session.started ? findRegionIndexFromPoint(event.clientX, event.clientY) : null;
    const originIndex = session.originIndex;
    const didStartDragging = session.started;

    resetDragState(event.pointerId);

    if (!didStartDragging || targetIndex === null || targetIndex === originIndex) {
      setActiveRegionIndex(originIndex);
      return;
    }

    setActiveRegionIndex(targetIndex);
    setVisibleCoverEntryIds((current) => updateVisibleCoverEntryIds(current, originIndex, targetIndex));
  }

  function handleVirtualPosterPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    resetDragState(event.pointerId);
  }

  async function handleDownload() {
    if (!snapshot) return;
    if (isWeChatBrowser) {
      onNotice("info", "长按预览图即可保存到手机。");
      return;
    }
    try {
      const blob =
        previewBlob ||
        (await generateEnhancedShareImageBlob({
          kind: snapshot.kind,
          shareId: snapshot.shareId,
          title: snapshot.title,
          games: snapshot.games,
          creatorName: snapshot.creatorName,
          shareMessage: snapshot.shareMessage,
          showNames: true,
          visibleCoverEntryIds,
        }));
      downloadBlob(blob, buildFileName(snapshot.kind, snapshot.title));
    } catch {
      onNotice("info", "下载失败，请长按预览图保存");
    }
  }

  function handleHeroCandidateSelect(entryId: string) {
    setActiveRegionIndex(0);
    setVisibleCoverEntryIds((current) => {
      if (current.length === 0 || current[0] === entryId) return current;
      const next = [...current];
      next[0] = entryId;
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-[linear-gradient(180deg,rgba(255,250,245,0.64),rgba(249,246,241,0.58))] backdrop-blur-[6px] data-[state=closed]:animate-none data-[state=open]:animate-none"
        closeClassName="border-border/80 bg-card/82 text-foreground opacity-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.36)] backdrop-blur-sm ring-0 ring-offset-0 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 hover:-translate-y-0.5 hover:bg-accent/78 hover:text-accent-foreground data-[state=open]:bg-card/88 data-[state=open]:text-foreground [-webkit-tap-highlight-color:transparent]"
        className="h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(252,248,243,0.92))] p-0 text-foreground shadow-none backdrop-blur-2xl data-[state=closed]:animate-none data-[state=open]:animate-none sm:h-[94vh] sm:w-[min(96vw,58rem)] sm:rounded-[2rem] sm:border sm:border-border/70 sm:shadow-[0_34px_88px_-48px_rgba(18,24,43,0.42),inset_0_1px_0_rgba(255,255,255,0.46)]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>分享图片</DialogTitle>
          <DialogDescription className="sr-only">
            预览当前歌曲分享海报，并保存到本地相册。
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(252,248,243,0.82))] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-5 sm:py-5">
          <div
            className={
              showPreviewOnlyLayout
                ? "flex min-h-0 flex-1 items-center justify-center"
                : "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:grid-cols-2 sm:grid-rows-1 sm:gap-3"
            }
          >
            {showPreviewOnlyLayout ? null : (
            <div className="min-h-0 overflow-hidden rounded-[1.8rem] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(246,248,253,0.82))] shadow-[0_28px_68px_-46px_rgba(15,20,35,0.24),inset_0_1px_0_rgba(255,255,255,0.42)]">
              <div className="flex h-full items-center justify-center px-2 py-2 sm:px-3 sm:py-3">
                {canEditCoverRegions ? (
                  <div
                    ref={virtualPosterRef}
                    className="relative flex h-full w-full items-center justify-center overflow-visible"
                    style={{
                      touchAction: draggingRegionIndex !== null ? "none" : "pan-y",
                    }}
                    onPointerDownCapture={handleVirtualPosterPointerDownCapture}
                    onPointerMove={handleVirtualPosterPointerMove}
                    onPointerUp={handleVirtualPosterPointerUp}
                    onPointerCancel={handleVirtualPosterPointerCancel}
                  >
                    <div className="pointer-events-none absolute inset-x-[8%] inset-y-[16%] rounded-[2.1rem] bg-[#0f1520]/10 blur-2xl" />

                    <div
                      className="relative flex h-full w-full items-center justify-center gap-2 sm:gap-3"
                    >
                      <div className="relative flex h-full w-full items-center justify-center gap-2 px-[4.5%] py-[5.5%] sm:gap-3">
                      <div
                        className="flex h-full w-[1.3rem] shrink-0 items-center justify-center text-center text-[0.72rem] font-semibold tracking-[0.18em] text-muted-foreground/82 sm:w-[1.5rem] sm:text-[0.8rem]"
                        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
                      >
                        点击切换头图
                      </div>
                      {heroCoverCandidates.length > 0 ? (
                        <div
                          className="flex h-full shrink-0 items-center justify-center"
                          style={{
                            width: heroCandidateLayout.gridWidth,
                          }}
                        >
                          <div
                            className="flex items-center justify-center"
                            style={{ columnGap: heroCandidateLayout.columnGap }}
                          >
                            {heroCandidateColumns.map((columnCandidates, columnIndex) => (
                              <div
                                key={`hero-column-${columnIndex}`}
                                className="flex flex-col items-center justify-center"
                                style={{ rowGap: heroCandidateLayout.rowGap }}
                              >
                                {columnCandidates.map((candidate) => {
                                  const index = heroCoverCandidates.findIndex(
                                    (item) => item.entryId === candidate.entryId
                                  );
                                  const isSelected = visibleCoverEntryIds[0] === candidate.entryId;

                                  return (
                                    <button
                                      key={candidate.entryId}
                                      type="button"
                                      data-testid={`share-image-hero-candidate-${index}`}
                                      onClick={() => handleHeroCandidateSelect(candidate.entryId)}
                                      className="group relative aspect-square rounded-[1.7rem] transition-transform duration-200 ease-out hover:scale-[1.03] focus:outline-none"
                                      style={{
                                        width: heroCandidateLayout.buttonSize,
                                        height: heroCandidateLayout.buttonSize,
                                        transform: "perspective(1000px) rotateX(15deg) rotateY(-15deg)",
                                      }}
                                      aria-pressed={isSelected}
                                    >
                                      <div className="pointer-events-none absolute -inset-[6%] rounded-[1.95rem] bg-[linear-gradient(145deg,rgba(255,252,248,0.94),rgba(226,233,244,0.84))] shadow-[0_18px_28px_rgba(16,22,36,0.16)] [transform:translate3d(0,0,-14px)]" />
                                      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.7rem] bg-[linear-gradient(135deg,rgba(255,153,88,0.72),rgba(49,160,255,0.52))] shadow-[0_14px_24px_rgba(15,20,35,0.16)]">
                                        {candidate.cover ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={candidate.cover}
                                            alt={candidate.title}
                                            className="h-full w-full object-cover"
                                            draggable={false}
                                          />
                                        ) : null}
                                      </div>
                                      <div
                                        className="pointer-events-none absolute inset-0 rounded-[1.7rem]"
                                        style={{
                                          boxShadow: isSelected
                                            ? "inset 0 0 0 2px rgba(255,255,255,0.96), 0 0 0 1px rgba(255,168,110,0.34)"
                                            : "inset 0 0 0 1px rgba(255,255,255,0.48)",
                                        }}
                                      />
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div
                        className="relative aspect-[1080/1440] h-full w-auto [transform-style:preserve-3d]"
                        style={{
                          maxWidth: heroCandidateLayout.posterMaxWidth,
                          transform: `perspective(1800px) translate3d(${boardTilt.translateX}px, ${boardTilt.translateY}px, 0) rotateX(${boardTilt.rotateX}deg) rotateY(${boardTilt.rotateY}deg)`,
                          transition:
                            draggingRegionIndex === null
                              ? "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)"
                              : "none",
                        }}
                      >
                        <div className="pointer-events-none absolute inset-[2%] rounded-[1.7rem] bg-[radial-gradient(circle_at_74%_78%,rgba(35,43,58,0.18),rgba(35,43,58,0)_54%)] blur-xl [transform:translate3d(0.55rem,0.8rem,-28px)]" />

                        <div className="relative h-full w-full overflow-hidden rounded-[1.7rem] border border-white/60 bg-[linear-gradient(180deg,rgba(255,249,244,0.98),rgba(239,246,255,0.9))] shadow-[0_24px_38px_rgba(16,22,36,0.16)]">
                        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0))]" />
                        <div className="absolute inset-[0.15rem] overflow-hidden rounded-[2rem]">

                        {backgroundVirtualSlots.map((slot) => {
                          const size = getRegionSize(slot.bounds);
                          const spread = getSpreadStyle(slot.bounds);
                          const clipPath = toCssClipPath(slot.region, slot.bounds);
                          const borderRadius = toHeroBorderRadius(slot.region);

                          return (
                            <div
                              key={`hit-${slot.index}-${slot.entryId}`}
                              data-share-image-hit-slot-index={slot.index}
                              className="pointer-events-none absolute"
                              style={{
                                left: `${((slot.bounds.minX + spread.insetX + spread.offsetX) / SONG_POSTER_CANVAS_WIDTH) * 100}%`,
                                top: `${((slot.bounds.minY + spread.insetY + spread.offsetY) / SONG_POSTER_CANVAS_HEIGHT) * 100}%`,
                                width: `${((size.width - spread.insetX * 2) / SONG_POSTER_CANVAS_WIDTH) * 100}%`,
                                height: `${((size.height - spread.insetY * 2) / SONG_POSTER_CANVAS_HEIGHT) * 100}%`,
                                clipPath,
                                borderRadius,
                              }}
                            />
                          );
                        })}

                        {backgroundVirtualSlots.map((slot) => {
                          const size = getRegionSize(slot.bounds);
                          const spread = getSpreadStyle(slot.bounds);
                          const clipPath = toCssClipPath(slot.region, slot.bounds);
                          const borderRadius = toHeroBorderRadius(slot.region);
                          const isDragging = draggingRegionIndex === slot.index;
                          const isSwapTarget =
                            hoverRegionIndex === slot.index &&
                            draggingRegionIndex !== null &&
                            draggingRegionIndex !== slot.index;
                          const liftDepth = isDragging
                            ? 22
                            : isSwapTarget
                              ? 68
                              : 0;
                          const scale = isDragging
                            ? 1.02
                            : isSwapTarget
                              ? 1.028
                              : 1;
                          const visualFilter = isSwapTarget
                            ? "brightness(1.05) saturate(1.04)"
                            : "none";

                          return (
                            <div
                              key={`${slot.index}-${slot.entryId}`}
                              className="absolute select-none will-change-transform"
                              style={{
                                left: `${((slot.bounds.minX + spread.insetX + spread.offsetX) / SONG_POSTER_CANVAS_WIDTH) * 100}%`,
                                top: `${((slot.bounds.minY + spread.insetY + spread.offsetY) / SONG_POSTER_CANVAS_HEIGHT) * 100}%`,
                                width: `${((size.width - spread.insetX * 2) / SONG_POSTER_CANVAS_WIDTH) * 100}%`,
                                height: `${((size.height - spread.insetY * 2) / SONG_POSTER_CANVAS_HEIGHT) * 100}%`,
                                opacity: isDragging ? 0.14 : 1,
                                transition:
                                  "opacity 150ms ease, transform 320ms cubic-bezier(0.22, 1, 0.36, 1), filter 320ms cubic-bezier(0.22, 1, 0.36, 1)",
                                transform: `translate3d(0,0,${liftDepth}px) scale(${scale})`,
                                filter: visualFilter,
                                zIndex: isDragging ? 40 : isSwapTarget ? 28 : 8 + slot.index,
                              }}
                            >
                              <div
                                className="pointer-events-none absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,rgba(255,153,88,0.72),rgba(49,160,255,0.52))] shadow-[0_14px_22px_rgba(15,20,35,0.12)]"
                                style={{
                                  clipPath,
                                  borderRadius,
                                  backgroundImage: slot.cover ? `url("${slot.cover}")` : undefined,
                                  backgroundPosition: "center",
                                  backgroundRepeat: "no-repeat",
                                  backgroundSize: "cover",
                                }}
                                />
                              <div
                                className="pointer-events-none absolute inset-0"
                                style={{
                                  clipPath,
                                  borderRadius,
                                  boxShadow: isSwapTarget
                                    ? "inset 0 0 0 2px rgba(255,255,255,0.96), 0 0 0 1px rgba(255,168,110,0.34), 0 16px 28px rgba(15,20,35,0.18)"
                                    : "inset 0 0 0 1px rgba(255,255,255,0.38)",
                                }}
                              />
                              <div
                                data-share-image-slot-index={slot.index}
                                data-testid={`share-image-virtual-slot-${slot.index}`}
                                className="absolute inset-0 z-20"
                                style={{
                                  clipPath,
                                  borderRadius,
                                }}
                              />
                            </div>
                          );
                        })}
                        </div>
                        </div>
                      </div>
                      <div
                        className="flex h-full w-[1.3rem] shrink-0 items-center justify-center text-center text-[0.72rem] font-semibold tracking-[0.18em] text-muted-foreground/82 sm:w-[1.5rem] sm:text-[0.8rem]"
                        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
                      >
                        拖动改变封面顺序
                      </div>
                      </div>

                      {dragGhostPosition && draggedSlot && dragSessionRef.current ? (
                        (() => {
                          const clipPath = toCssClipPath(draggedSlot.region, draggedSlot.bounds);
                          const borderRadius =
                            draggedSlot.index === 0 ? "24px" : toHeroBorderRadius(draggedSlot.region);

                          return (
                            <div
                              className="pointer-events-none absolute left-0 top-0 z-[60] will-change-transform"
                              style={{
                                left: dragGhostPosition.x,
                                top: dragGhostPosition.y,
                                width: dragSessionRef.current.ghostWidth,
                                height: dragSessionRef.current.ghostHeight,
                                transform: `translate(-50%, -50%) perspective(1400px) rotateX(${boardTilt.rotateX}deg) rotateY(${boardTilt.rotateY}deg) rotateZ(-4deg) scale(1.03) translateZ(24px)`,
                              }}
                            >
                              <div
                                className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,rgba(255,153,88,0.82),rgba(49,160,255,0.58))] shadow-[0_32px_52px_rgba(12,18,32,0.28)]"
                                style={{
                                  clipPath,
                                  borderRadius,
                                  backgroundImage: draggedSlot.cover ? `url("${draggedSlot.cover}")` : undefined,
                                  backgroundPosition: "center",
                                  backgroundRepeat: "no-repeat",
                                  backgroundSize: "cover",
                                }}
                              />
                              <div
                                className="absolute inset-0"
                                style={{
                                  clipPath,
                                  borderRadius,
                                  boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.95)",
                                }}
                              />
                            </div>
                          );
                        })()
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex aspect-[1080/1440] h-full w-auto max-w-full items-center justify-center rounded-[1.6rem] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,249,253,0.82))] px-4 text-center text-sm text-muted-foreground">
                    至少选 2 首歌后才可以调整封面位置
                  </div>
                )}
              </div>
            </div>
            )}

            <div
              className={`relative min-h-0 overflow-hidden rounded-[1.8rem] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,255,0.76))] shadow-[0_28px_68px_-46px_rgba(15,20,35,0.28),inset_0_1px_0_rgba(255,255,255,0.4)] ${
                showPreviewOnlyLayout ? "w-full max-w-[min(100%,30rem)] self-center" : ""
              }`}
            >
              {isWeChatBrowser ? null : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDownload}
                  disabled={loading}
                  className="absolute right-3 top-3 z-20 h-9 rounded-full border-white/75 bg-[rgba(255,251,246,0.98)] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-md sm:right-4 sm:top-4"
                >
                  下载图片
                </Button>
              )}
              <div
                className={`flex h-full items-center justify-center gap-2 px-2 py-2 sm:gap-3 sm:px-3 sm:py-3 ${
                  showPreviewOnlyLayout ? "h-auto flex-col justify-center gap-1.5 py-4" : ""
                }`}
              >
                {showPreviewOnlyLayout || !previewInstruction ? null : (
                  <div
                    className="grid h-full min-h-0 w-[2.65rem] shrink-0 grid-cols-[0.8rem_minmax(0,1fr)] items-stretch self-stretch sm:w-[3.2rem] sm:grid-cols-[1rem_minmax(0,1fr)]"
                  >
                    <div aria-hidden="true" />
                    <div
                      className="flex h-full min-h-0 items-center justify-center text-center text-[0.68rem] font-semibold tracking-[0.14em] text-muted-foreground/82 sm:text-[0.76rem]"
                      style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
                    >
                      {previewInstruction}
                    </div>
                  </div>
                )}
                <div
                  className={`relative aspect-[1080/1440] max-w-full ${
                    showPreviewOnlyLayout
                      ? "w-full max-w-[min(100%,28rem)]"
                      : "h-full w-auto"
                  }`}
                >
                  {previewUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="分享图片预览"
                        className={`h-full w-full rounded-[1.4rem] object-contain transition-opacity duration-200 ${
                          loading ? "opacity-92" : "opacity-100"
                        }`}
                        draggable={false}
                        style={{
                          WebkitTouchCallout: "default",
                          WebkitUserSelect: "auto",
                          userSelect: "auto",
                        }}
                      />
                      {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center rounded-[1.4rem] bg-white/12 backdrop-blur-[1px]">
                          <div className="text-sm font-semibold text-white [text-shadow:0_2px_10px_rgba(15,20,35,0.42)]">
                            重新生成中
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : loading ? (
                    <div className="h-full w-full animate-pulse rounded-[1.4rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,247,252,0.72))]" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-[1.4rem] border border-rose-200/80 bg-rose-50/80 px-5 text-center text-sm text-rose-500">
                      {previewError || "预览图加载失败"}
                    </div>
                  )}
                </div>
                {showPreviewOnlyLayout ? (
                  <div className="text-center text-sm font-semibold leading-none text-muted-foreground/82">
                    {previewOnlyInstruction}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
