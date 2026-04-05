"use client";

import QRCode from "qrcode";
import { getSongShareSubtitle } from "@/lib/song-share";
import { SubjectKind, getSubjectKindShareTitle } from "@/lib/subject-kind";
import { ShareGame } from "@/lib/share/types";

export const SONG_POSTER_CANVAS_WIDTH = 1080;
export const SONG_POSTER_CANVAS_HEIGHT = 1440;

const CANVAS_WIDTH = SONG_POSTER_CANVAS_WIDTH;
const CANVAS_HEIGHT = SONG_POSTER_CANVAS_HEIGHT;

export type PosterPoint = {
  x: number;
  y: number;
};

export type PosterCoverRegion =
  | {
      kind: "hero";
      index: number;
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
    }
  | {
      kind: "background";
      index: number;
      points: PosterPoint[];
    };

type GridExportItem = {
  entryId: string;
  cover: string | null;
  title: string;
  subtitle?: string;
  alignTop?: boolean;
};

function displayName(game: ShareGame | null): string {
  if (!game) return "未选择";
  return game.localizedName?.trim() || game.name;
}

function displayShareMessage(shareMessage?: string | null): string {
  const value = shareMessage?.trim();
  return value || "";
}

async function srcToImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片加载失败"));
  });
  return image;
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await srcToImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return srcToImage(dataUrl);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("无法生成图片数据"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: { alignTop?: boolean }
) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = x + (width - drawWidth) / 2;
  const offsetY = options?.alignTop ? y : y + (height - drawHeight) / 2;
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function shouldTopCropCover(kind?: SubjectKind) {
  void kind;
  return false;
}

function trimTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let output = text;
  while (output && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
}

function normalizeCoverUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }

  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }

  try {
    return new URL(raw).toString();
  } catch {
    try {
      return new URL(raw, "https://bgm.tv").toString();
    } catch {
      return null;
    }
  }
}

function toWsrvUrl(value: string): string | null {
  const normalized = normalizeCoverUrl(value);
  if (!normalized) return null;
  if (normalized.startsWith("data:") || normalized.startsWith("blob:")) {
    return normalized;
  }
  return `https://wsrv.nl/?url=${encodeURIComponent(normalized)}&w=640&output=webp`;
}

async function loadCoverImage(cover: string): Promise<HTMLImageElement | null> {
  const normalized = normalizeCoverUrl(cover);
  if (!normalized) return null;

  if (normalized.startsWith("data:") || normalized.startsWith("blob:")) {
    try {
      return await srcToImage(normalized);
    } catch {
      return null;
    }
  }

  const wsrvUrl = toWsrvUrl(normalized);
  if (!wsrvUrl) return null;

  try {
    const response = await fetch(wsrvUrl, { cache: "force-cache" });
    if (!response.ok) return null;
    return await blobToImage(await response.blob());
  } catch {
    return null;
  }
}

async function loadCovers(items: GridExportItem[]) {
  return Promise.all(items.map(async (item) => {
    const cover = item.cover?.trim();
    if (!cover) return null;
    return loadCoverImage(cover);
  }));
}

function polygonBounds(points: Array<{ x: number; y: number }>) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function buildRoundedRectPathData(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `A ${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + height - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>
) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
}

function drawImageInPolygon(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  points: Array<{ x: number; y: number }>
) {
  ctx.save();
  drawPolygon(ctx, points);
  ctx.clip();

  const bounds = polygonBounds(points);
  if (image) {
    drawCoverFit(
      ctx,
      image,
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY
    );
  } else {
    const fallback = ctx.createLinearGradient(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    fallback.addColorStop(0, "rgba(255,149,84,0.75)");
    fallback.addColorStop(1, "rgba(36,162,255,0.45)");
    ctx.fillStyle = fallback;
    ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  }
  ctx.restore();
}

function wrapTextToLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
) {
  const chars = Array.from(text.trim());
  if (chars.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = "";

  for (const char of chars) {
    const next = `${current}${char}`;
    if (ctx.measureText(next).width <= maxWidth || current.length === 0) {
      current = next;
      continue;
    }

    lines.push(current);
    current = char;
    if (lines.length === maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  if (lines.length === maxLines && chars.join("").length > lines.join("").length) {
    lines[maxLines - 1] = trimTextToWidth(ctx, lines[maxLines - 1], maxWidth);
  }

  return lines;
}

function projectRayToBounds(centerX: number, centerY: number, dx: number, dy: number) {
  const candidates: number[] = [];

  if (dx > 0) {
    candidates.push((CANVAS_WIDTH - centerX) / dx);
  } else if (dx < 0) {
    candidates.push((0 - centerX) / dx);
  }

  if (dy > 0) {
    candidates.push((CANVAS_HEIGHT - centerY) / dy);
  } else if (dy < 0) {
    candidates.push((0 - centerY) / dy);
  }

  const distance = Math.min(...candidates.filter((value) => value > 0));
  return {
    x: centerX + dx * distance,
    y: centerY + dy * distance,
  };
}

function createAngledSplitLine(yAtCenter: number, angleDeg: number) {
  const slope = Math.tan((angleDeg * Math.PI) / 180);
  const halfWidth = CANVAS_WIDTH / 2;
  return {
    left: {
      x: 0,
      y: yAtCenter - halfWidth * slope,
    },
    right: {
      x: CANVAS_WIDTH,
      y: yAtCenter + halfWidth * slope,
    },
  };
}

function createGridPolygons(columns: number, rows: number) {
  const cellWidth = CANVAS_WIDTH / columns;
  const cellHeight = CANVAS_HEIGHT / rows;

  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const right = (column + 1) * cellWidth;
    const top = row * cellHeight;
    const bottom = (row + 1) * cellHeight;

    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
  });
}

function createSkewedGridPolygons(columns: number, rows: number, angleDeg: number) {
  const cellWidth = CANVAS_WIDTH / columns;
  const cellHeight = CANVAS_HEIGHT / rows;
  const offset = Math.tan((angleDeg * Math.PI) / 180) * cellHeight;

  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const top = row * cellHeight;
    const bottom = (row + 1) * cellHeight;

    const leftTop = column === 0 ? 0 : column * cellWidth - offset / 2;
    const leftBottom = column === 0 ? 0 : column * cellWidth + offset / 2;
    const rightTop = column === columns - 1 ? CANVAS_WIDTH : (column + 1) * cellWidth - offset / 2;
    const rightBottom = column === columns - 1 ? CANVAS_WIDTH : (column + 1) * cellWidth + offset / 2;

    return [
      { x: leftTop, y: top },
      { x: rightTop, y: top },
      { x: rightBottom, y: bottom },
      { x: leftBottom, y: bottom },
    ];
  });
}

function createAlternatingStripePolygons(count: number, angleDeg: number) {
  const lines = Array.from({ length: count - 1 }, (_, index) =>
    createAngledSplitLine(
      (CANVAS_HEIGHT * (index + 1)) / count,
      index % 2 === 0 ? angleDeg : -angleDeg
    )
  );

  const polygons: Array<Array<{ x: number; y: number }>> = [];

  polygons.push([
    { x: 0, y: 0 },
    { x: CANVAS_WIDTH, y: 0 },
    lines[0].right,
    lines[0].left,
  ]);

  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    polygons.push([
      previous.left,
      previous.right,
      current.right,
      current.left,
    ]);
  }

  const lastLine = lines[lines.length - 1];
  polygons.push([
    lastLine.left,
    lastLine.right,
    { x: CANVAS_WIDTH, y: CANVAS_HEIGHT },
    { x: 0, y: CANVAS_HEIGHT },
  ]);

  return polygons;
}

function drawPosterTextLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetY?: number;
  }
) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = options.strokeStyle;
  ctx.lineWidth = options.lineWidth;
  ctx.shadowColor = options.shadowColor;
  ctx.shadowBlur = options.shadowBlur;
  ctx.shadowOffsetY = options.shadowOffsetY ?? 0;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = options.fillStyle;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function sampleAverageColor(image: HTMLImageElement | null) {
  if (!image) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let red = 0;
    let green = 0;
    let blue = 0;
    let pixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      pixels += 1;
    }

    if (pixels === 0) return null;

    return {
      r: red / pixels,
      g: green / pixels,
      b: blue / pixels,
    };
  } catch {
    return null;
  }
}

function createPosterStrokeColor(image: HTMLImageElement | null) {
  const average = sampleAverageColor(image);
  if (!average) {
    return "rgba(26,32,44,0.6)";
  }

  const luminance = average.r * 0.299 + average.g * 0.587 + average.b * 0.114;
  const stroke = {
    r: Math.round(average.r * 0.16 + luminance * 0.14 + 44 * 0.7),
    g: Math.round(average.g * 0.16 + luminance * 0.14 + 49 * 0.7),
    b: Math.round(average.b * 0.16 + luminance * 0.14 + 60 * 0.7),
  };

  return `rgba(${stroke.r},${stroke.g},${stroke.b},0.6)`;
}

function createSongBackgroundPolygons(count: number) {
  if (count <= 1) {
    return [
      [
        { x: 0, y: 0 },
        { x: CANVAS_WIDTH, y: 0 },
        { x: CANVAS_WIDTH, y: CANVAS_HEIGHT },
        { x: 0, y: CANVAS_HEIGHT },
      ],
    ];
  }

  if (count === 2) {
    const centerX = CANVAS_WIDTH / 2;
    const centerY = CANVAS_HEIGHT / 2;
    const angle = (-75 * Math.PI) / 180;
    const topPoint = projectRayToBounds(centerX, centerY, Math.cos(angle), Math.sin(angle));
    const bottomPoint = projectRayToBounds(centerX, centerY, -Math.cos(angle), -Math.sin(angle));

    return [
      [
        { x: 0, y: 0 },
        topPoint,
        bottomPoint,
        { x: 0, y: CANVAS_HEIGHT },
      ],
      [
        topPoint,
        { x: CANVAS_WIDTH, y: 0 },
        { x: CANVAS_WIDTH, y: CANVAS_HEIGHT },
        bottomPoint,
      ],
    ];
  }

  if (count === 3) {
    const centerX = CANVAS_WIDTH / 2;
    const centerY = CANVAS_HEIGHT / 2;
    const topPoint = projectRayToBounds(centerX, centerY, 0, -1);
    const leftPoint = projectRayToBounds(centerX, centerY, -Math.cos(Math.PI / 6), Math.sin(Math.PI / 6));
    const rightPoint = projectRayToBounds(centerX, centerY, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6));

    return [
      [
        { x: centerX, y: centerY },
        topPoint,
        { x: 0, y: 0 },
        leftPoint,
      ],
      [
        { x: centerX, y: centerY },
        rightPoint,
        { x: CANVAS_WIDTH, y: 0 },
        topPoint,
      ],
      [
        { x: centerX, y: centerY },
        leftPoint,
        { x: 0, y: CANVAS_HEIGHT },
        { x: CANVAS_WIDTH, y: CANVAS_HEIGHT },
        rightPoint,
      ],
    ];
  }

  if (count === 4 || count === 5) {
    return createAlternatingStripePolygons(count, 15);
  }

  if (count === 7) {
    return createAlternatingStripePolygons(count, 5);
  }

  if (count === 6) {
    return createGridPolygons(3, 2);
  }

  if (count === 8) {
    return createSkewedGridPolygons(4, 2, 5);
  }

  if (count === 9) {
    return createGridPolygons(3, 3);
  }

  const segmentWidth = CANVAS_WIDTH / count;
  const slant = Math.max(120, 240 - count * 12);

  return Array.from({ length: count }, (_, index) => {
    const left = index * segmentWidth;
    const right = (index + 1) * segmentWidth;
    const tilt = index % 2 === 0 ? slant : -slant;

    return [
      { x: left - slant * 0.55, y: 0 },
      { x: right + slant * 0.22, y: 0 },
      { x: right - tilt * 0.44, y: CANVAS_HEIGHT },
      { x: left - tilt, y: CANVAS_HEIGHT },
    ];
  });
}

function getSongPosterHeroSize(count: number) {
  return count <= 2 ? 360 : count <= 5 ? 336 : 312;
}

export function getSongPosterCoverRegions(count: number): PosterCoverRegion[] {
  const safeCount = Math.max(1, count);
  const heroSize = getSongPosterHeroSize(safeCount);
  const heroRegion: PosterCoverRegion = {
    kind: "hero",
    index: 0,
    x: 72,
    y: 148,
    width: heroSize,
    height: heroSize,
    radius: 34,
  };

  const backgroundRegions = createSongBackgroundPolygons(safeCount).map((points, index) => ({
    kind: "background" as const,
    index: index + 1,
    points,
  }));

  return [heroRegion, ...backgroundRegions];
}

export function posterCoverRegionToSvgPath(region: PosterCoverRegion) {
  if (region.kind === "hero") {
    return buildRoundedRectPathData(
      region.x,
      region.y,
      region.width,
      region.height,
      region.radius
    );
  }

  return `M ${region.points.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
}

function drawSongPosterBackground(
  ctx: CanvasRenderingContext2D,
  covers: Array<HTMLImageElement | null>,
  count: number
) {
  const base = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  base.addColorStop(0, "#131722");
  base.addColorStop(0.5, "#1d2435");
  base.addColorStop(1, "#121827");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const polygons = createSongBackgroundPolygons(count);
  polygons.forEach((points, index) => {
    const cover = covers[index] || covers[index % Math.max(covers.length, 1)] || null;
    drawImageInPolygon(ctx, cover, points);
  });

  const overlay = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  overlay.addColorStop(0, "rgba(7,10,18,0.38)");
  overlay.addColorStop(0.55, "rgba(7,10,18,0.64)");
  overlay.addColorStop(1, "rgba(7,10,18,0.86)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const glow = ctx.createRadialGradient(280, 250, 40, 280, 250, 720);
  glow.addColorStop(0, "rgba(255,180,112,0.42)");
  glow.addColorStop(0.42, "rgba(255,180,112,0.16)");
  glow.addColorStop(1, "rgba(255,180,112,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

async function createSongPosterCanvas(options: {
  title: string;
  subtitle: string;
  subtitleIsShareMessage?: boolean;
  listItems: GridExportItem[];
  heroItem: GridExportItem | null;
  backgroundItems: GridExportItem[];
  qrUrl?: string | null;
  showNames?: boolean;
}) {
  const selectedItems = options.listItems.filter((item) => item.title.trim().length > 0).slice(0, 9);
  const posterItems =
    selectedItems.length > 0
      ? selectedItems
      : [
          {
            entryId: "fallback-empty",
            cover: null,
            title: "未选择",
            subtitle: "",
          },
        ];
  const heroItem =
    options.heroItem ||
    posterItems[0] || {
      entryId: "fallback-hero",
      cover: null,
      title: "未选择",
      subtitle: "",
    };
  const backgroundItems =
    options.backgroundItems.length > 0
      ? options.backgroundItems
      : [
          {
            entryId: heroItem.entryId,
            cover: heroItem.cover,
            title: heroItem.title,
            subtitle: heroItem.subtitle,
            alignTop: heroItem.alignTop,
          },
        ];
  const [heroCover, ...backgroundCovers] = await loadCovers([heroItem, ...backgroundItems]);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建导出画布");
  }

  drawSongPosterBackground(ctx, backgroundCovers, posterItems.length);

  const heroRegion = getSongPosterCoverRegions(posterItems.length)[0];
  const heroSize = heroRegion.kind === "hero" ? heroRegion.width : getSongPosterHeroSize(posterItems.length);
  const heroX = heroRegion.kind === "hero" ? heroRegion.x : 72;
  const heroY = heroRegion.kind === "hero" ? heroRegion.y : 148;
  const heroRadius = heroRegion.kind === "hero" ? heroRegion.radius : 34;
  const headingStrokeColor = createPosterStrokeColor(heroCover);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 22;
  roundedRectPath(ctx, heroX, heroY, heroSize, heroSize, heroRadius);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, heroX, heroY, heroSize, heroSize, heroRadius);
  ctx.clip();
  if (heroCover) {
    drawCoverFit(ctx, heroCover, heroX, heroY, heroSize, heroSize);
  } else {
    const heroFallback = ctx.createLinearGradient(heroX, heroY, heroX + heroSize, heroY + heroSize);
    heroFallback.addColorStop(0, "#ff9958");
    heroFallback.addColorStop(1, "#2aa8ff");
    ctx.fillStyle = heroFallback;
    ctx.fillRect(heroX, heroY, heroSize, heroSize);
  }
  ctx.restore();

  roundedRectPath(ctx, heroX, heroY, heroSize, heroSize, heroRadius);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const textX = heroX + heroSize + 52;
  const textWidth = CANVAS_WIDTH - textX - 70;
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 64px sans-serif";
  const titleLines = wrapTextToLines(ctx, options.title, textWidth, 3);
  titleLines.forEach((line, index) => {
    drawPosterTextLine(ctx, line, textX, 242 + index * 74, {
      fillStyle: "#ffffff",
      strokeStyle: headingStrokeColor,
      lineWidth: 8,
      shadowColor: "transparent",
      shadowBlur: 0,
      shadowOffsetY: 0,
    });
  });

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  const subtitleFontSize = options.subtitleIsShareMessage ? 26 : 28;
  const subtitleLineHeight = options.subtitleIsShareMessage ? 40 : 44;
  const subtitleMaxLines = options.subtitleIsShareMessage ? 5 : 3;
  ctx.font = `600 ${subtitleFontSize}px sans-serif`;
  const subtitleLines = wrapTextToLines(ctx, options.subtitle, textWidth, subtitleMaxLines);
  subtitleLines.forEach((line, index) => {
    drawPosterTextLine(ctx, line, textX, 242 + titleLines.length * 74 + 34 + index * subtitleLineHeight, {
      fillStyle: "rgba(255,255,255,0.88)",
      strokeStyle: headingStrokeColor,
      lineWidth: 5,
      shadowColor: "transparent",
      shadowBlur: 0,
      shadowOffsetY: 0,
    });
  });

  const panelX = 52;
  const panelY = options.showNames === false ? 980 : 770;
  const panelHeight = options.showNames === false ? 230 : 580;
  const panelWidth = CANVAS_WIDTH - panelX * 2;
  const qrSize = options.qrUrl ? 164 : 0;
  const panelPadding = 34;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 20;
  roundedRectPath(ctx, panelX, panelY, panelWidth, panelHeight, 32);
  ctx.fillStyle = "rgba(8, 12, 20, 0.50)";
  ctx.fill();
  ctx.restore();

  roundedRectPath(ctx, panelX, panelY, panelWidth, panelHeight, 32);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.stroke();

  let qrImage: HTMLImageElement | null = null;
  if (options.qrUrl) {
    const qrDataUrl = await QRCode.toDataURL(options.qrUrl, {
      width: qrSize,
      margin: 1,
      color: {
        dark: "#111827",
        light: "#FFFFFF",
      },
    });
    qrImage = await dataUrlToImage(qrDataUrl);
  }

  const listX = panelX + panelPadding;
  const listAreaWidth = panelWidth - panelPadding * 2 - (qrImage ? qrSize + 28 : 0);
  const listY = panelY + 60;
  const columnCount = posterItems.length > 4 ? 2 : 1;
  const rowsPerColumn = columnCount === 1 ? posterItems.length : Math.ceil(posterItems.length / columnCount);
  const columnGap = 28;
  const columnWidth = columnCount === 1 ? listAreaWidth : (listAreaWidth - columnGap) / 2;

  if (options.showNames !== false) {
    posterItems.forEach((item, index) => {
      const columnIndex = columnCount === 1 ? 0 : Math.floor(index / rowsPerColumn);
      const rowIndex = columnCount === 1 ? index : index % rowsPerColumn;
      const x = listX + columnIndex * (columnWidth + columnGap);
      const y = listY + rowIndex * 92;

      ctx.fillStyle = "rgba(255,255,255,0.90)";
      ctx.font = "700 24px sans-serif";
      ctx.fillText(String(index + 1).padStart(2, "0"), x, y);

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 29px sans-serif";
      ctx.fillText(trimTextToWidth(ctx, item.title, columnWidth - 44), x + 44, y);

      if (item.subtitle) {
        ctx.fillStyle = "rgba(255,255,255,0.70)";
        ctx.font = "500 22px sans-serif";
        ctx.fillText(trimTextToWidth(ctx, item.subtitle, columnWidth - 44), x + 44, y + 34);
      }
    });
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.74)";
    ctx.font = "600 28px sans-serif";
    ctx.fillText("封面已生成，适合直接发给朋友。", listX, listY + 20);
  }

  if (qrImage) {
    const qrX = panelX + panelWidth - qrSize - panelPadding;
    const qrY = panelY + panelHeight - qrSize - panelPadding;
    ctx.save();
    roundedRectPath(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 28);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.restore();
    ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("扫码立即收听", qrX + qrSize / 2, qrY - 22);
    ctx.textAlign = "left";
  }

  return canvas;
}

export function getShareGameEntryId(game: ShareGame, index: number) {
  const entryId = game.entryId?.trim();
  if (entryId) return entryId;
  return `share-cover-${String(game.id)}-${index + 1}`;
}

function toShareGridItems(kind: SubjectKind | undefined, games: Array<ShareGame | null>): GridExportItem[] {
  return games.flatMap((game, index) => {
    if (!game) return [];
    return [
      {
        entryId: getShareGameEntryId(game, index),
        cover: game.cover || null,
        title: displayName(game),
        subtitle: game.name || "",
        alignTop: shouldTopCropCover(kind),
      },
    ];
  });
}

export function buildDefaultCoverOrderEntryIds(games: Array<ShareGame | null>) {
  return toShareGridItems(undefined, games).map((item) => item.entryId);
}

export function buildVisibleCoverEntryIdsFromCoverOrder(coverOrder: readonly string[]) {
  if (coverOrder.length === 0) return [];
  return [coverOrder[0], ...coverOrder];
}

export function buildDefaultVisibleCoverEntryIds(games: Array<ShareGame | null>) {
  return buildVisibleCoverEntryIdsFromCoverOrder(buildDefaultCoverOrderEntryIds(games));
}

function resolveVisibleCoverItems(
  items: GridExportItem[],
  visibleCoverEntryIds?: string[]
) {
  if (items.length === 0) {
    const fallback: GridExportItem = {
      entryId: "fallback-empty",
      cover: null,
      title: "未选择",
      subtitle: "",
    };

    return {
      visibleCoverEntryIds: [fallback.entryId, fallback.entryId],
      heroItem: fallback,
      backgroundItems: [fallback],
      listItems: [fallback],
    };
  }

  const defaultVisibleCoverEntryIds = [items[0].entryId, ...items.map((item) => item.entryId)];
  const itemsByEntryId = new Map(items.map((item) => [item.entryId, item] as const));
  const normalizedVisibleCoverEntryIds = defaultVisibleCoverEntryIds.map((defaultEntryId, index) => {
    const candidateEntryId = visibleCoverEntryIds?.[index];
    if (candidateEntryId && itemsByEntryId.has(candidateEntryId)) {
      return candidateEntryId;
    }
    return defaultEntryId;
  });

  const coverItems = normalizedVisibleCoverEntryIds.map((entryId, index) => {
    return itemsByEntryId.get(entryId) || itemsByEntryId.get(defaultVisibleCoverEntryIds[index]) || items[0];
  });

  return {
    visibleCoverEntryIds: normalizedVisibleCoverEntryIds,
    heroItem: coverItems[0] || items[0],
    backgroundItems: coverItems.slice(1),
    listItems: items,
  };
}

export async function generateStandardShareImageBlob(options: {
  kind?: SubjectKind;
  games: Array<ShareGame | null>;
  creatorName?: string | null;
  shareMessage?: string | null;
  title?: string;
  showNames?: boolean;
  visibleCoverEntryIds?: string[];
}) {
  const posterState = resolveVisibleCoverItems(toShareGridItems(options.kind, options.games), options.visibleCoverEntryIds);
  const selectedCount = options.games.filter((game) => Boolean(game)).length;
  const subtitle = getSongShareSubtitle(selectedCount, options.shareMessage);
  const title =
    options.title ||
    getSubjectKindShareTitle("song", {
      creatorName: options.creatorName,
      selectedCount,
    });
  const canvas = await createSongPosterCanvas({
    title,
    subtitle,
    subtitleIsShareMessage: Boolean(displayShareMessage(options.shareMessage)),
    listItems: posterState.listItems,
    heroItem: posterState.heroItem,
    backgroundItems: posterState.backgroundItems,
    showNames: options.showNames,
  });
  return canvasToBlob(canvas);
}

export async function generateEnhancedShareImageBlob(options: {
  kind: SubjectKind;
  shareId: string;
  title: string;
  games: Array<ShareGame | null>;
  creatorName?: string | null;
  shareMessage?: string | null;
  origin?: string;
  showNames?: boolean;
  visibleCoverEntryIds?: string[];
}) {
  const origin = options.origin ?? window.location.origin;
  const shareUrl = `${origin}/${options.kind}/s/${options.shareId}`;
  const posterState = resolveVisibleCoverItems(toShareGridItems(options.kind, options.games), options.visibleCoverEntryIds);
  const selectedCount = options.games.filter((game) => Boolean(game)).length;
  const subtitle = getSongShareSubtitle(selectedCount, options.shareMessage);
  const canvas = await createSongPosterCanvas({
    title: options.title,
    subtitle,
    subtitleIsShareMessage: Boolean(displayShareMessage(options.shareMessage)),
    listItems: posterState.listItems,
    heroItem: posterState.heroItem,
    backgroundItems: posterState.backgroundItems,
    qrUrl: shareUrl,
    showNames: options.showNames,
  });

  (window as typeof window & Record<string, unknown>).__SONGSHARE_LAST_SHARE_EXPORT__ = {
    width: canvas.width,
    height: canvas.height,
    showNames: options.showNames !== false,
    qrUrl: shareUrl,
    mode: "song-poster",
    visibleCoverEntryIds: posterState.visibleCoverEntryIds,
  };

  return canvasToBlob(canvas);
}

export async function generateLocalTestImageBlob() {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 640;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建测试画布");
  }

  ctx.fillStyle = "#f3f6fb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(60, 60, canvas.width - 120, canvas.height - 120);
  ctx.strokeStyle = "#dbe4f0";
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 60, canvas.width - 120, canvas.height - 120);

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 46px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("保存图片测试", canvas.width / 2, 240);

  ctx.fillStyle = "#475569";
  ctx.font = "600 28px sans-serif";
  ctx.fillText("如果这张图可以正常下载，当前浏览器环境通常可用。", canvas.width / 2, 310);
  ctx.fillText("若失败，请复制 /song 到系统浏览器继续。", canvas.width / 2, 360);

  return canvasToBlob(canvas);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("download", filename);
  link.setAttribute("href", url);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportEnhancedShareImage(options: {
  kind: SubjectKind;
  shareId: string;
  title: string;
  games: Array<ShareGame | null>;
  creatorName?: string | null;
  shareMessage?: string | null;
  origin?: string;
  showNames?: boolean;
}) {
  const blob = await generateEnhancedShareImageBlob(options);
  const fileName = `${options.title}.png`;
  downloadBlob(blob, fileName);
}
