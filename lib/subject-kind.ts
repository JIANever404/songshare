export type SubjectKind = "song";

export const DEFAULT_SUBJECT_KIND: SubjectKind = "song";
export const SUBJECT_KIND_ORDER: SubjectKind[] = ["song"];

export type SubjectKindMeta = {
  kind: SubjectKind;
  label: string;
  longLabel: string;
  selectionUnit: string;
  subtitle: string;
  searchPlaceholder: string;
  searchDialogTitle: string;
  searchIdleHint: string;
  draftStorageKey: string;
  trendLabel: string;
};

export type SubjectShareTitleOptions = {
  creatorName?: string | null;
  selectedCount?: number;
};

const SONG_KIND_META: SubjectKindMeta = {
  kind: "song",
  label: "歌曲",
  longLabel: "歌曲",
  selectionUnit: "首",
  subtitle: "把你喜欢的歌分享出去。",
  searchPlaceholder: "输入歌曲名称",
  searchDialogTitle: "搜索歌曲",
  searchIdleHint: "输入歌曲名称开始搜索",
  draftStorageKey: "my-nine-song:v1",
  trendLabel: "歌曲",
};

export function getSubjectKindMeta(kind: SubjectKind): SubjectKindMeta {
  void kind;
  return SONG_KIND_META;
}

export function getSubjectKindShareTitle(
  kind: SubjectKind,
  options: SubjectShareTitleOptions = {}
): string {
  void kind;
  const creatorName = options.creatorName?.trim() || "我";
  const selectedCount = Number.isFinite(options.selectedCount)
    ? Math.max(1, Math.min(9, Math.trunc(options.selectedCount as number)))
    : 1;
  return `${creatorName}分享给你${selectedCount}首歌`;
}

export function parseSubjectKind(value: string | null | undefined): SubjectKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "song" ? "song" : null;
}

export function toSubjectKindOrDefault(value: string | null | undefined): SubjectKind {
  return parseSubjectKind(value) ?? DEFAULT_SUBJECT_KIND;
}
