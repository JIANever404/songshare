import snapshotItems from "@/lib/generated/song-recommendations.snapshot.json";
import snapshotMeta from "@/lib/generated/song-recommendations.snapshot-meta.json";
import type { RecommendedShareGame, SongRecommendationResponse } from "@/lib/share/types";
import type { SubjectKind } from "@/lib/subject-kind";

type SongRecommendationSnapshotMeta = {
  version?: string;
  generatedAt?: string;
};

function readRecommendationSnapshotItems(): RecommendedShareGame[] {
  if (!Array.isArray(snapshotItems)) {
    return [];
  }

  return snapshotItems as RecommendedShareGame[];
}

function readRecommendationSnapshotMeta(): SongRecommendationSnapshotMeta {
  if (!snapshotMeta || typeof snapshotMeta !== "object") {
    return {};
  }

  return snapshotMeta as SongRecommendationSnapshotMeta;
}

export function getSongRecommendationSnapshotVersion() {
  const meta = readRecommendationSnapshotMeta();
  return typeof meta.version === "string" && meta.version.trim() ? meta.version : "static";
}

export function getSongRecommendationSnapshotGeneratedAt() {
  const meta = readRecommendationSnapshotMeta();
  return typeof meta.generatedAt === "string" && meta.generatedAt.trim()
    ? meta.generatedAt
    : null;
}

export async function fetchSongRecommendations(kind: SubjectKind): Promise<RecommendedShareGame[]> {
  if (kind !== "song") {
    return [];
  }

  return readRecommendationSnapshotItems();
}

export function buildSongRecommendationResponse(params: {
  kind: SubjectKind;
  items: RecommendedShareGame[];
}): SongRecommendationResponse {
  return {
    ok: true,
    source: "apple-charts",
    kind: params.kind,
    items: params.items,
    snapshotVersion: getSongRecommendationSnapshotVersion(),
    snapshotGeneratedAt: getSongRecommendationSnapshotGeneratedAt(),
  };
}
