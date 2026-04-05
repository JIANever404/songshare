import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Converter } from "opencc-js";

const execFileAsync = promisify(execFile);
const LOOKUP_BATCH_SIZE = 50;
const traditionalToSimplified = Converter({ from: "hk", to: "cn" });

function parseArgs(argv) {
  const options = {
    database: "",
    config: "",
    local: false,
    remote: false,
    cwd: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--database") {
      options.database = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token === "--config") {
      options.config = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token === "--cwd") {
      options.cwd = argv[index + 1] || options.cwd;
      index += 1;
      continue;
    }
    if (token === "--local") {
      options.local = true;
      continue;
    }
    if (token === "--remote") {
      options.remote = true;
      continue;
    }
  }

  if (!options.database) {
    throw new Error("missing --database");
  }
  if (options.local === options.remote) {
    throw new Error("specify exactly one of --local or --remote");
  }

  return options;
}

function escapeSqlString(value) {
  return value.replace(/'/g, "''");
}

function toNullableSqlString(value) {
  if (!value) {
    return "NULL";
  }
  return `'${escapeSqlString(value)}'`;
}

function toNullableSqlNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "NULL";
  }
  return String(Math.trunc(value));
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function runWranglerJson(options, extraArgs) {
  const args = ["wrangler", "d1", "execute", options.database];
  if (options.config) {
    args.push("--config", options.config);
  }
  args.push(options.local ? "--local" : "--remote");
  args.push("--json");
  args.push(...extraArgs);

  const { stdout } = await execFileAsync("npx", args, {
    cwd: options.cwd,
    maxBuffer: 1024 * 1024 * 16,
  });

  return JSON.parse(stdout);
}

async function querySongRows(options) {
  const data = await runWranglerJson(options, [
    "--command",
    "SELECT subject_id, name, localized_name, cover, release_year FROM songshare_subject_dim_v1 WHERE kind = 'song' ORDER BY updated_at DESC",
  ]);

  return data?.[0]?.results ?? [];
}

function normalizeCover(url) {
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }
  return url.replace("100x100bb", "1000x1000bb");
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return traditionalToSimplified(trimmed);
}

function normalizeReleaseYear(value) {
  if (typeof value !== "string" || value.length < 4) {
    return null;
  }
  const parsed = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function lookupSongsByIds(ids) {
  const results = new Map();

  for (const batch of chunkArray(ids, LOOKUP_BATCH_SIZE)) {
    const url = new URL("https://itunes.apple.com/lookup");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("country", "cn");
    url.searchParams.set("entity", "song");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`itunes lookup failed: ${response.status}`);
    }

    const json = await response.json();
    for (const item of json.results ?? []) {
      if (typeof item.trackId !== "number") {
        continue;
      }
      results.set(String(item.trackId), {
        name: normalizeText(item.artistName),
        localizedName: normalizeText(item.trackName),
        cover: normalizeCover(item.artworkUrl100),
        releaseYear: normalizeReleaseYear(item.releaseDate),
      });
    }
  }

  return results;
}

async function applyUpdates(options, updates) {
  if (updates.length === 0) {
    return 0;
  }

  for (const item of updates) {
    const sql = [
      "UPDATE songshare_subject_dim_v1",
      "SET",
      `  name = '${escapeSqlString(item.name)}',`,
      `  localized_name = ${toNullableSqlString(item.localizedName)},`,
      `  cover = ${toNullableSqlString(item.cover)},`,
      `  release_year = ${toNullableSqlNumber(item.releaseYear)},`,
      `  updated_at = ${Date.now()}`,
      `WHERE kind = 'song' AND subject_id = '${escapeSqlString(item.subjectId)}'`,
    ].join("\n");

    await runWranglerJson(options, ["--command", sql]);
  }

  return updates.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await querySongRows(options);
  const ids = rows
    .map((row) => String(row.subject_id || "").trim())
    .filter(Boolean);

  if (ids.length === 0) {
    console.log(JSON.stringify({ updated: 0, total: 0, message: "no_song_rows" }, null, 2));
    return;
  }

  const lookup = await lookupSongsByIds(ids);
  const updates = [];

  for (const row of rows) {
    const subjectId = String(row.subject_id || "").trim();
    if (!subjectId) {
      continue;
    }

    const match = lookup.get(subjectId);
    const currentName = typeof row.name === "string" ? row.name.trim() : "";
    const currentLocalizedName =
      typeof row.localized_name === "string" ? row.localized_name.trim() : "";
    const currentCover = typeof row.cover === "string" ? row.cover.trim() : "";
    const currentReleaseYear =
      typeof row.release_year === "number" || typeof row.release_year === "string"
        ? Number(row.release_year)
        : null;
    const normalizedCurrentName = normalizeText(currentName);
    const normalizedCurrentLocalizedName = normalizeText(currentLocalizedName);
    const desiredName = match?.name || normalizedCurrentName || currentName;
    const desiredLocalizedName =
      match?.localizedName || normalizedCurrentLocalizedName || currentLocalizedName || null;
    const desiredCover = match?.cover ?? (currentCover || null);
    const desiredReleaseYear = match?.releaseYear ?? currentReleaseYear;

    const needsUpdate =
      currentName !== desiredName ||
      currentLocalizedName !== (desiredLocalizedName || "") ||
      currentCover !== (desiredCover || "") ||
      currentReleaseYear !== desiredReleaseYear;

    if (!needsUpdate) {
      continue;
    }

    updates.push({
      subjectId,
      name: desiredName,
      localizedName: desiredLocalizedName,
      cover: desiredCover,
      releaseYear: desiredReleaseYear,
    });
  }

  const updated = await applyUpdates(options, updates);

  console.log(
    JSON.stringify(
      {
        updated,
        total: rows.length,
        target: options.remote ? "remote" : "local",
        database: options.database,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
