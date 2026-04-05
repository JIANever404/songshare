import { createHash } from "node:crypto";

function sanitizeEntryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function normalizeSubjectKey(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "unknown";
}

function buildEntryHash(seed: string) {
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

export function normalizeShareEntryId(value: unknown): string | null {
  return sanitizeEntryId(value);
}

export function buildStoredShareEntryId(params: {
  shareId: string;
  slotIndex: number;
  subjectId: unknown;
}) {
  const subjectKey = normalizeSubjectKey(params.subjectId);
  return `e-${params.slotIndex + 1}-${buildEntryHash(`${params.shareId}:${params.slotIndex}:${subjectKey}`)}`;
}

export function buildLegacyShareEntryId(params: {
  slotIndex: number;
  subjectId: unknown;
}) {
  const subjectKey = normalizeSubjectKey(params.subjectId);
  return `legacy-${params.slotIndex + 1}-${buildEntryHash(`${params.slotIndex}:${subjectKey}`)}`;
}
