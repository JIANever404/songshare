import { cookies } from "next/headers";
import { getSongRecommendationSnapshotGeneratedAt } from "@/lib/itunes/charts";
import { SITE_VISITORS_TABLE, toNumber } from "@/lib/share/storage-common";
import { ensureD1Schema, execute, getD1Database, queryFirst } from "@/lib/share/storage-d1-runtime";

const VISITOR_COOKIE_NAME = "songshare_visitor_id";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2;
const VISITOR_TOUCH_INTERVAL = 1000 * 60 * 60 * 12;

type VisitorCountRow = {
  total_count: number | string;
};

function formatDeployDate(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

export async function getFooterDeployTimeLabel() {
  return formatDeployDate(getSongRecommendationSnapshotGeneratedAt());
}

export async function registerFooterVisit() {
  const deployTimeLabel = await getFooterDeployTimeLabel();
  const now = Date.now();
  const cookieStore = await cookies();
  const existingVisitorId = cookieStore.get(VISITOR_COOKIE_NAME)?.value?.trim() || null;

  const db = await getD1Database();
  if (!db || !(await ensureD1Schema())) {
    return {
      deployTimeLabel,
      visitorCount: null as number | null,
      nextVisitorId: existingVisitorId,
    };
  }

  let visitorId = existingVisitorId;
  let shouldWriteCookie = false;

  if (!visitorId) {
    visitorId = crypto.randomUUID();
    shouldWriteCookie = true;

    await execute(
      db,
      `
      INSERT OR IGNORE INTO ${SITE_VISITORS_TABLE} (visitor_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?)
      `,
      [visitorId, now, now]
    );
  } else {
    const existingRow = await queryFirst<{ last_seen_at: number | string }>(
      db,
      `
      SELECT last_seen_at
      FROM ${SITE_VISITORS_TABLE}
      WHERE visitor_id = ?
      LIMIT 1
      `,
      [visitorId]
    );

    if (!existingRow) {
      await execute(
        db,
        `
        INSERT OR IGNORE INTO ${SITE_VISITORS_TABLE} (visitor_id, first_seen_at, last_seen_at)
        VALUES (?, ?, ?)
        `,
        [visitorId, now, now]
      );
      shouldWriteCookie = true;
    } else if (now - toNumber(existingRow.last_seen_at, 0) >= VISITOR_TOUCH_INTERVAL) {
      await execute(
        db,
        `
        UPDATE ${SITE_VISITORS_TABLE}
        SET last_seen_at = ?
        WHERE visitor_id = ?
        `,
        [now, visitorId]
      );
    }
  }

  const countRow = await queryFirst<VisitorCountRow>(
    db,
    `
    SELECT COUNT(*) AS total_count
    FROM ${SITE_VISITORS_TABLE}
    `
  );

  return {
    deployTimeLabel,
    visitorCount: toNumber(countRow?.total_count, 0),
    nextVisitorId: shouldWriteCookie ? visitorId : null,
  };
}

export { VISITOR_COOKIE_MAX_AGE, VISITOR_COOKIE_NAME };
