import type { SubjectKind } from "@/lib/subject-kind";

export type GameTypeId = 0 | 1 | 2 | 3 | 4 | 8 | 9 | 10 | 11;

export interface ShareSubject {
  id: number | string;
  entryId?: string;
  name: string;
  localizedName?: string;
  cover: string | null;
  releaseYear?: number;
  gameTypeId?: GameTypeId;
  platforms?: string[];
  genres?: string[];
  storeUrls?: Record<string, string>;
  comment?: string;
  spoiler?: boolean;
  subjectType?: number;
  subjectPlatform?: string | null;
}

export type ShareGame = ShareSubject;

export type RecommendedShareGame = ShareGame & {
  chartStorefront: string;
  chartRank: number;
  isHot: boolean;
};

export type ShareEntry = ShareSubject & {
  entryId: string;
};

export interface SubjectSearchResponse {
  ok: boolean;
  source: "itunes";
  kind: SubjectKind;
  items: ShareSubject[];
  noResultQuery: string | null;
}

export interface SongRecommendationResponse {
  ok: boolean;
  source: "apple-charts";
  kind: SubjectKind;
  items: RecommendedShareGame[];
  error?: string;
  snapshotVersion?: string;
  snapshotGeneratedAt?: string | null;
}

export type GameSearchResponse = SubjectSearchResponse;

export interface StoredShareV2 {
  shareId: string;
  kind: SubjectKind;
  creatorName: string | null;
  shareMessage?: string | null;
  games: Array<ShareSubject | null>;
  coverOrder?: string[];
  createdAt: number;
  updatedAt: number;
  lastViewedAt: number;
}

export type StoredShare = StoredShareV2;
export type StoredShareV1 = StoredShareV2;
