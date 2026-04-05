#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_SITE_URLS = {
  production: "https://songshare.example.com",
  test: "https://test.songshare.example.com",
  free: "https://songshare.example.com",
};
const DEFAULT_WRANGLER_CONFIGS = {
  production: "wrangler.jsonc",
  test: "wrangler.jsonc",
  free: "wrangler.free.jsonc",
};
const SHELL_SITE_URL = process.env.SITE_URL;
const SHELL_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

const SECRET_KEYS = [
  "NEXT_PUBLIC_GA_ID",
  "NEXT_PUBLIC_SITE_URL",
  "SITE_URL",
];

function readFlag(name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === exact) {
      return process.argv[index + 1] ?? null;
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length) || null;
    }
  }
  return null;
}

function resolveTargetEnv() {
  const profile = readFlag("profile");
  if (profile === "free") {
    return "free";
  }
  const envName = readFlag("env");
  return envName === "test" ? "test" : "production";
}

function loadLocalEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), file));
    } catch {
      // ignore missing env files
    }
  }
}

function resolveSiteUrl(targetEnv) {
  return (
    readFlag("site-url") ??
    SHELL_SITE_URL ??
    SHELL_PUBLIC_SITE_URL ??
    DEFAULT_SITE_URLS[targetEnv]
  );
}

function resolveWranglerConfig(targetEnv) {
  return readFlag("config") ?? DEFAULT_WRANGLER_CONFIGS[targetEnv];
}

function buildSecrets(targetEnv) {
  const siteUrl = resolveSiteUrl(targetEnv);
  const secrets = {};

  for (const key of SECRET_KEYS) {
    const value = (() => {
      if (key === "SITE_URL" || key === "NEXT_PUBLIC_SITE_URL") {
        return siteUrl;
      }
      return process.env[key];
    })();

    if (typeof value === "string" && value.trim()) {
      secrets[key] = value.trim();
    }
  }

  return {
    secrets,
    siteUrl,
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`command exited via signal: ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
    child.on("error", reject);
  });
}

async function main() {
  loadLocalEnvFiles();

  const targetEnv = resolveTargetEnv();
  const { secrets, siteUrl } = buildSecrets(targetEnv);
  const wranglerConfig = resolveWranglerConfig(targetEnv);
  const names = Object.keys(secrets).sort();

  if (names.length === 0) {
    throw new Error("no secrets found to upload");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "songshare-cf-secrets-"));
  const tempFile = path.join(tempDir, "secrets.json");

  try {
    await writeFile(tempFile, JSON.stringify(secrets, null, 2), "utf8");
    console.log(`[cf:sync-secrets] target=${targetEnv} siteUrl=${siteUrl}`);
    console.log(`[cf:sync-secrets] uploading ${names.length} keys: ${names.join(", ")}`);

    const args = ["wrangler", "secret", "bulk", tempFile, `--config=${wranglerConfig}`];
    if (targetEnv === "test") {
      args.push("--env=test");
    }

    const exitCode = await run("npx", args);
    process.exitCode = exitCode;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
