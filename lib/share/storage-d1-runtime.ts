import path from "node:path";
import {
  MAX_BATCH_SIZE,
  SHARES_V2_TABLE,
  SITE_VISITORS_TABLE,
  SUBJECT_DIM_TABLE,
  chunkArray,
  readEnv,
} from "@/lib/share/storage-common";

export type D1Scalar = string | number | null;

export type D1PreparedStatementLike = {
  bind: (...values: D1Scalar[]) => D1PreparedStatementLike;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] } | T[]>;
  run: () => Promise<{ meta?: { changes?: number } } | { changes?: number } | unknown>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatementLike;
  batch: (statements: D1PreparedStatementLike[]) => Promise<unknown[]>;
  exec: (query: string) => Promise<unknown>;
};

export type StatementInput = {
  sql: string;
  params?: D1Scalar[];
};

const D1_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ${SHARES_V2_TABLE} (
  share_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  creator_name TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  hot_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_viewed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ${SHARES_V2_TABLE}_kind_created_idx
ON ${SHARES_V2_TABLE} (kind, created_at DESC);
CREATE TABLE IF NOT EXISTS ${SUBJECT_DIM_TABLE} (
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  localized_name TEXT,
  cover TEXT,
  release_year INTEGER,
  genres TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, subject_id)
);
CREATE INDEX IF NOT EXISTS ${SUBJECT_DIM_TABLE}_subject_idx
ON ${SUBJECT_DIM_TABLE} (subject_id);
CREATE TABLE IF NOT EXISTS ${SITE_VISITORS_TABLE} (
  visitor_id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ${SITE_VISITORS_TABLE}_last_seen_idx
ON ${SITE_VISITORS_TABLE} (last_seen_at DESC);
`;

type LocalPlatformEnv = {
  SONGSHARE_DB?: D1DatabaseLike;
};

type GlobalRuntimeWithEnv = typeof globalThis & {
  __SONGSHARE_CF_ENV?: LocalPlatformEnv;
};

let localPlatformPromise: Promise<LocalPlatformEnv | null> | null = null;
let d1DatabasePromise: Promise<D1DatabaseLike | null> | null = null;
let d1SchemaReadyPromise: Promise<boolean> | null = null;
let d1RuntimeStatus = "uninitialized";

function setD1RuntimeStatus(message: string) {
  d1RuntimeStatus = message;
}

export function getD1RuntimeStatus() {
  return d1RuntimeStatus;
}

async function getCloudflareBoundD1(): Promise<D1DatabaseLike | null> {
  const globalEnv = (globalThis as GlobalRuntimeWithEnv).__SONGSHARE_CF_ENV;
  const globalDb = globalEnv?.SONGSHARE_DB;
  if (globalDb && typeof globalDb.prepare === "function") {
    setD1RuntimeStatus("using global Cloudflare env binding");
    return globalDb;
  }

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = (await getCloudflareContext({ async: true })) as { env?: LocalPlatformEnv };
    const db = context?.env?.SONGSHARE_DB;
    if (db && typeof db.prepare === "function") {
      setD1RuntimeStatus("using OpenNext Cloudflare context binding");
    } else {
      setD1RuntimeStatus("OpenNext Cloudflare context has no SONGSHARE_DB binding");
    }
    return db && typeof db.prepare === "function" ? db : null;
  } catch (error) {
    setD1RuntimeStatus(`getCloudflareContext failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function getLocalPlatformEnv(): Promise<LocalPlatformEnv | null> {
  if (!localPlatformPromise) {
    localPlatformPromise = (async () => {
      try {
        // Keep Wrangler out of the production worker bundle.
        const wranglerModuleName = ["wran", "gler"].join("");
        const { getPlatformProxy } = (await import(
          wranglerModuleName
        )) as typeof import("wrangler");
        const environment = readEnv("SONGSHARE_DB_WRANGLER_ENV", "NEXT_DEV_WRANGLER_ENV") ?? undefined;
        const platform = await getPlatformProxy<LocalPlatformEnv>({
          configPath: path.resolve(process.cwd(), "wrangler.jsonc"),
          environment,
          persist: true,
          remoteBindings: false,
        });
        const env = platform.env ?? null;
        if (!env) {
          console.warn("[songshare] getPlatformProxy resolved without env bindings");
          setD1RuntimeStatus("getPlatformProxy resolved without env bindings");
          localPlatformPromise = null;
        }
        return env;
      } catch (error) {
        console.warn("[songshare] getPlatformProxy failed in local dev", error);
        setD1RuntimeStatus(`getPlatformProxy failed: ${error instanceof Error ? error.message : String(error)}`);
        localPlatformPromise = null;
        return null;
      }
    })();
  }
  return localPlatformPromise;
}

export async function getD1Database(): Promise<D1DatabaseLike | null> {
  if (!d1DatabasePromise) {
    d1DatabasePromise = (async () => {
      const bound = await getCloudflareBoundD1();
      if (bound) return bound;

      const localEnv = await getLocalPlatformEnv();
      const localDb = localEnv?.SONGSHARE_DB;
      const db = localDb && typeof localDb.prepare === "function" ? localDb : null;
      if (!db) {
        setD1RuntimeStatus("local platform env has no SONGSHARE_DB binding");
        d1DatabasePromise = null;
      } else {
        setD1RuntimeStatus("using Wrangler local platform proxy binding");
      }
      return db;
    })();
  }
  return d1DatabasePromise;
}

export async function ensureD1Schema(): Promise<boolean> {
  const db = await getD1Database();
  if (!db) {
    setD1RuntimeStatus(`ensureD1Schema skipped: ${d1RuntimeStatus}`);
    return false;
  }

  if ((globalThis as GlobalRuntimeWithEnv).__SONGSHARE_CF_ENV?.SONGSHARE_DB) {
    setD1RuntimeStatus("schema ensured via Cloudflare env binding");
    return true;
  }

  if (!d1SchemaReadyPromise) {
    d1SchemaReadyPromise = (async () => {
      try {
        const probe = await db
          .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1")
          .bind("table", SHARES_V2_TABLE)
          .all<{ name?: string }>();
        const probeRows = Array.isArray(probe) ? probe : Array.isArray(probe.results) ? probe.results : [];
        if (probeRows.length > 0) {
          setD1RuntimeStatus("schema detected via sqlite_master");
          return true;
        }

        await db.exec(D1_SCHEMA_SQL);
        setD1RuntimeStatus("schema ensured via local db.exec");
        return true;
      } catch {
        setD1RuntimeStatus("db.exec failed while ensuring schema");
        d1SchemaReadyPromise = null;
        return false;
      }
    })();
  }

  return d1SchemaReadyPromise;
}

export async function isD1RuntimeAvailable(): Promise<boolean> {
  return (await getD1Database()) !== null;
}

export function buildPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export async function queryAll<T = Record<string, unknown>>(
  db: D1DatabaseLike,
  sql: string,
  params: D1Scalar[] = []
): Promise<T[]> {
  const prepared = db.prepare(sql).bind(...params.map((value) => (value === undefined ? null : value)));
  const result = await prepared.all<T>();
  if (Array.isArray(result)) {
    return result;
  }
  return Array.isArray(result.results) ? result.results : [];
}

export async function queryFirst<T = Record<string, unknown>>(
  db: D1DatabaseLike,
  sql: string,
  params: D1Scalar[] = []
): Promise<T | null> {
  const rows = await queryAll<T>(db, sql, params);
  return rows[0] ?? null;
}

export function readChangeCount(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const record = result as { meta?: { changes?: number }; changes?: number };
  if (typeof record.meta?.changes === "number") return Math.trunc(record.meta.changes);
  if (typeof record.changes === "number") return Math.trunc(record.changes);
  return 0;
}

export async function execute(db: D1DatabaseLike, sql: string, params: D1Scalar[] = []): Promise<number> {
  const result = await db.prepare(sql).bind(...params.map((value) => (value === undefined ? null : value))).run();
  return readChangeCount(result);
}

export async function executeBatch(db: D1DatabaseLike, statements: StatementInput[]): Promise<number> {
  let changes = 0;
  for (const chunk of chunkArray(statements, MAX_BATCH_SIZE)) {
    const result = await db.batch(chunk.map((statement) => db.prepare(statement.sql).bind(...(statement.params ?? []))));
    for (const item of result) {
      changes += readChangeCount(item);
    }
  }
  return changes;
}
