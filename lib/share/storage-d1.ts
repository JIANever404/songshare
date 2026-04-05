import type { SubjectSnapshot } from "@/lib/share/compact";
import {
  compactPayloadToGames,
  createCompactHotPayload,
  createContentHash,
  parseCompactHotPayload,
  toCompactSharePayload,
} from "@/lib/share/compact";
import type { StorageBackend } from "@/lib/share/storage-contract";
import type { StoredShareV1 } from "@/lib/share/types";
import { DEFAULT_SUBJECT_KIND, type SubjectKind, parseSubjectKind } from "@/lib/subject-kind";
import {
  SHARES_V2_TABLE,
  SUBJECT_DIM_TABLE,
  type ShareRegistryRow,
  type SubjectDimRow,
  chunkArray,
  collectSubjectIdsFromPayload,
  normalizeStoredShare,
  parseJsonValue,
  parseStringArray,
  throwStorageError,
  toNumber,
  toSubjectSnapshot,
} from "@/lib/share/storage-common";
import {
  type D1DatabaseLike,
  type StatementInput,
  buildPlaceholders,
  ensureD1Schema,
  execute,
  executeBatch,
  getD1Database,
  getD1RuntimeStatus,
  queryAll,
  queryFirst,
} from "@/lib/share/storage-d1-runtime";

type ShareCountRow = {
  total_count: number | string;
};

function resolveCompactShareData(row: ShareRegistryRow) {
  return parseCompactHotPayload(parseJsonValue<unknown>(row.hot_payload));
}

function toOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function normalizeGenreList(genres: string[] | undefined): string[] {
  return Array.from(new Set((genres ?? []).map((genre) => genre.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

async function fetchExistingSubjectDimRows(db: D1DatabaseLike, kind: SubjectKind, subjectIds: string[]) {
  const rowsById = new Map<string, SubjectDimRow>();
  for (const ids of chunkArray(subjectIds, 96)) {
    if (ids.length === 0) continue;
    const rows = await queryAll<SubjectDimRow>(
      db,
      `
      SELECT subject_id, name, localized_name, cover, release_year, genres
      FROM ${SUBJECT_DIM_TABLE}
      WHERE kind = ?
        AND subject_id IN (${buildPlaceholders(ids.length)})
      `,
      [kind, ...ids]
    );
    for (const row of rows) {
      rowsById.set(row.subject_id, row);
    }
  }
  return rowsById;
}

function buildSubjectDimStatement(params: {
  kind: SubjectKind;
  snapshot: SubjectSnapshot;
  existingRow?: SubjectDimRow;
  updatedAt: number;
}): StatementInput | null {
  const existingRow = params.existingRow;
  const desiredGenres = normalizeGenreList(params.snapshot.genres);
  const existingGenres = normalizeGenreList(existingRow ? parseStringArray(existingRow.genres) : undefined);
  const desiredLocalizedName = params.snapshot.localizedName ?? existingRow?.localized_name ?? null;
  const desiredCover = params.snapshot.cover ?? existingRow?.cover ?? null;
  const desiredReleaseYear = params.snapshot.releaseYear ?? toOptionalNumber(existingRow?.release_year);
  const mergedGenres = desiredGenres.length > 0 ? desiredGenres : existingGenres;

  if (
    existingRow &&
    existingRow.name === params.snapshot.name &&
    (existingRow.localized_name ?? null) === desiredLocalizedName &&
    (existingRow.cover ?? null) === desiredCover &&
    toOptionalNumber(existingRow.release_year) === desiredReleaseYear &&
    areStringArraysEqual(existingGenres, mergedGenres)
  ) {
    return null;
  }

  return {
    sql: `
    INSERT INTO ${SUBJECT_DIM_TABLE} (
      kind, subject_id, name, localized_name, cover, release_year, genres, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, subject_id) DO UPDATE SET
      name = excluded.name,
      localized_name = excluded.localized_name,
      cover = excluded.cover,
      release_year = excluded.release_year,
      genres = excluded.genres,
      updated_at = excluded.updated_at
    `,
    params: [
      params.kind,
      params.snapshot.subjectId,
      params.snapshot.name,
      desiredLocalizedName,
      desiredCover,
      desiredReleaseYear,
      mergedGenres.length > 0 ? JSON.stringify(mergedGenres) : null,
      params.updatedAt,
    ],
  };
}

async function fetchSubjectSnapshots(db: D1DatabaseLike, kind: SubjectKind, subjectIds: string[]) {
  const snapshots = new Map<string, SubjectSnapshot>();
  for (const ids of chunkArray(subjectIds, 96)) {
    if (ids.length === 0) continue;
    const rows = await queryAll<SubjectDimRow>(
      db,
      `
      SELECT subject_id, name, localized_name, cover, release_year, genres
      FROM ${SUBJECT_DIM_TABLE}
      WHERE kind = ?
        AND subject_id IN (${buildPlaceholders(ids.length)})
      `,
      [kind, ...ids]
    );
    for (const row of rows) {
      snapshots.set(row.subject_id, toSubjectSnapshot(row));
    }
  }
  return snapshots;
}

async function inflateShareFromRegistryRow(db: D1DatabaseLike, row: ShareRegistryRow): Promise<StoredShareV1 | null> {
  const kind = parseSubjectKind(row.kind) ?? DEFAULT_SUBJECT_KIND;
  const compact = resolveCompactShareData(row);
  if (!compact) return null;

  const subjectSnapshots = await fetchSubjectSnapshots(db, kind, collectSubjectIdsFromPayload(compact.payload));
  return normalizeStoredShare({
    shareId: String(row.share_id),
    kind,
    creatorName: typeof row.creator_name === "string" ? row.creator_name : null,
    shareMessage: compact.shareMessage,
    games: compactPayloadToGames({ payload: compact.payload, subjectSnapshots }),
    coverOrder: compact.coverOrder ?? undefined,
    createdAt: toNumber(row.created_at, Date.now()),
    updatedAt: toNumber(row.updated_at, Date.now()),
    lastViewedAt: toNumber(row.last_viewed_at, Date.now()),
  });
}

async function resolveExistingShareIdByHash(db: D1DatabaseLike, contentHash: string) {
  const row = await queryFirst<{ share_id: string }>(
    db,
    `
    SELECT share_id
    FROM ${SHARES_V2_TABLE}
    WHERE content_hash = ?
    LIMIT 1
    `,
    [contentHash]
  );
  return row?.share_id ?? null;
}

const d1StorageBackend: StorageBackend = {
  name: "d1",

  async saveShare(record) {
    const normalizedRecord = normalizeStoredShare(record);
    const { payload, subjectSnapshots } = toCompactSharePayload(normalizedRecord.games);
    const hotPayload = createCompactHotPayload({
      payload,
      shareMessage: normalizedRecord.shareMessage,
      coverOrder: normalizedRecord.coverOrder,
    });
    const contentHash = createContentHash({
      kind: normalizedRecord.kind,
      creatorName: normalizedRecord.creatorName,
      shareMessage: normalizedRecord.shareMessage,
      payload,
      coverOrder: normalizedRecord.coverOrder,
    });

    const db = await getD1Database();
    if (!db || !(await ensureD1Schema())) {
      throw new Error(`saveShare failed: d1 is not ready (${getD1RuntimeStatus()})`);
    }

    const existingShareId = await resolveExistingShareIdByHash(db, contentHash);
    if (existingShareId) {
      return { shareId: existingShareId, deduped: true };
    }

    const subjectRows = Array.from(subjectSnapshots.values());
    const existingSubjectRows = await fetchExistingSubjectDimRows(
      db,
      normalizedRecord.kind,
      subjectRows.map((snapshot) => snapshot.subjectId)
    );
    const subjectDimStatements = subjectRows
      .map((snapshot) =>
        buildSubjectDimStatement({
          kind: normalizedRecord.kind,
          snapshot,
          existingRow: existingSubjectRows.get(snapshot.subjectId),
          updatedAt: normalizedRecord.updatedAt,
        })
      )
      .filter((statement): statement is StatementInput => Boolean(statement));

    const statements: StatementInput[] = [
      {
        sql: `
        INSERT INTO ${SHARES_V2_TABLE} (
          share_id, kind, creator_name, content_hash, hot_payload, created_at, updated_at, last_viewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        params: [
          normalizedRecord.shareId,
          normalizedRecord.kind,
          normalizedRecord.creatorName,
          contentHash,
          JSON.stringify(hotPayload),
          normalizedRecord.createdAt,
          normalizedRecord.updatedAt,
          normalizedRecord.lastViewedAt,
        ],
      },
      ...subjectDimStatements,
    ];

    try {
      await executeBatch(db, statements);
      return { shareId: normalizedRecord.shareId, deduped: false };
    } catch (error) {
      const raceWinner = await resolveExistingShareIdByHash(db, contentHash);
      if (raceWinner) {
        return { shareId: raceWinner, deduped: true };
      }
      throwStorageError("saveShare failed: d1 write error", error);
    }
  },

  async getShare(shareId) {
    const db = await getD1Database();
    if (!db || !(await ensureD1Schema())) {
      throw new Error(`getShare failed: d1 is not ready (${getD1RuntimeStatus()})`);
    }

    const row = await queryFirst<ShareRegistryRow>(
      db,
      `
      SELECT share_id, kind, creator_name, hot_payload, created_at, updated_at, last_viewed_at
      FROM ${SHARES_V2_TABLE}
      WHERE share_id = ?
      LIMIT 1
      `,
      [shareId]
    );

    return row ? await inflateShareFromRegistryRow(db, row) : null;
  },

  async touchShare(shareId, now = Date.now()) {
    const db = await getD1Database();
    if (!db || !(await ensureD1Schema())) {
      throw new Error("touchShare failed: d1 is not ready");
    }

    return (
      (await execute(
        db,
        `
        UPDATE ${SHARES_V2_TABLE}
        SET updated_at = ?, last_viewed_at = ?
        WHERE share_id = ?
        `,
        [now, now, shareId]
      )) > 0
    );
  },

  async listAllShares() {
    const db = await getD1Database();
    if (!db || !(await ensureD1Schema())) {
      throw new Error("listAllShares failed: d1 is not ready");
    }

    const rows = await queryAll<ShareRegistryRow>(
      db,
      `
      SELECT share_id, kind, creator_name, hot_payload, created_at, updated_at, last_viewed_at
      FROM ${SHARES_V2_TABLE}
      ORDER BY created_at DESC
      `
    );

    const result: StoredShareV1[] = [];
    for (const row of rows) {
      const inflated = await inflateShareFromRegistryRow(db, row);
      if (inflated) {
        result.push(inflated);
      }
    }
    return result;
  },

  async countAllShares() {
    const db = await getD1Database();
    if (!db || !(await ensureD1Schema())) {
      throw new Error("countAllShares failed: d1 is not ready");
    }

    const row = await queryFirst<ShareCountRow>(
      db,
      `
      SELECT COUNT(*) AS total_count
      FROM ${SHARES_V2_TABLE}
      `
    );
    return toNumber(row?.total_count, 0);
  },
};

export default d1StorageBackend;
