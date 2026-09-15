#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_BATCHES = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_LIMIT = 500;
const MAX_BATCHES = 20;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RETRY_DELAY_MS = 10_000;

function failConfiguration(message) {
  const error = new Error(message);
  error.kind = "configuration";
  return error;
}

function parseBoundedInteger(value, name, minimum, maximum) {
  if (!/^\d+$/.test(String(value || ""))) {
    throw failConfiguration(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw failConfiguration(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    check: false,
    limit: DEFAULT_LIMIT,
    maxBatches: DEFAULT_MAX_BATCHES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const mappings = {
      "--limit": ["limit", 1, MAX_LIMIT],
      "--max-batches": ["maxBatches", 1, MAX_BATCHES],
      "--timeout-ms": ["timeoutMs", 1_000, MAX_TIMEOUT_MS],
      "--retry-delay-ms": ["retryDelayMs", 0, MAX_RETRY_DELAY_MS],
    };
    const mapping = mappings[argument];
    if (!mapping) throw failConfiguration(`Unknown option: ${argument}`);
    const next = argv[index + 1];
    if (next === undefined) throw failConfiguration(`${argument} requires a value.`);
    const [key, minimum, maximum] = mapping;
    options[key] = parseBoundedInteger(next, argument, minimum, maximum);
    index += 1;
  }
  return options;
}

export function readConfiguration(environment = process.env) {
  const endpointValue = String(environment.STORAGE_CLEANUP_URL || "").trim();
  const secret = String(environment.STORAGE_CLEANUP_SECRET || "");
  if (!endpointValue) throw failConfiguration("STORAGE_CLEANUP_URL is required.");
  if (!secret) throw failConfiguration("STORAGE_CLEANUP_SECRET is required.");

  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw failConfiguration("STORAGE_CLEANUP_URL must be a valid URL.");
  }
  const isLocal = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "[::1]";
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && isLocal)) {
    throw failConfiguration("STORAGE_CLEANUP_URL must use HTTPS (HTTP is allowed only for local tests).");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw failConfiguration("STORAGE_CLEANUP_URL must not include credentials, query parameters, or a fragment.");
  }
  if (!endpoint.pathname.endsWith("/functions/v1/process-storage-cleanup")) {
    throw failConfiguration("STORAGE_CLEANUP_URL must point to the process-storage-cleanup function.");
  }
  return { endpoint: endpoint.toString(), secret };
}

function responseCount(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name} count in cleanup response.`);
  return value;
}

function parseResponse(payload, limit) {
  if (!payload || payload.ok !== true) throw new Error("Cleanup endpoint reported an error.");
  const result = {
    staleUploadsQueued: responseCount(payload.staleUploadsQueued, "staleUploadsQueued"),
    claimed: responseCount(payload.claimed, "claimed"),
    completed: responseCount(payload.completed, "completed"),
    deletedObjects: responseCount(payload.deletedObjects, "deletedObjects"),
    failed: Array.isArray(payload.failed)
      ? payload.failed.length
      : responseCount(payload.failedCount ?? 0, "failed"),
  };
  if (result.claimed > limit) throw new Error("Cleanup endpoint exceeded the requested batch limit.");
  if (result.completed + result.failed !== result.claimed) {
    throw new Error("Cleanup endpoint returned inconsistent job counts.");
  }
  return result;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function invokeBatch({ endpoint, secret, limit, timeoutMs, retryDelayMs, fetchImpl, logger }) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "x-cleanup-secret": secret,
        },
        body: JSON.stringify({ limit }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!response.ok) {
        if (retryable && attempt < maxAttempts) {
          logger.warn(`[storage-cleanup] request failed; retrying (${attempt}/${maxAttempts}).`);
          await delay(retryDelayMs * attempt);
          continue;
        }
        throw new Error(`Cleanup endpoint returned HTTP ${response.status}.`);
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Cleanup endpoint returned invalid JSON.");
      }
      return parseResponse(payload, limit);
    } catch (error) {
      const isFinal = attempt === maxAttempts;
      const isHttpError = error instanceof Error && error.message.startsWith("Cleanup endpoint returned HTTP ");
      const isProtocolError = error instanceof Error && error.message.startsWith("Cleanup endpoint ");
      if (isHttpError || isProtocolError) throw error;
      if (isFinal) throw new Error("Cleanup request failed after 3 attempts; check connectivity and endpoint configuration.");
      logger.warn(`[storage-cleanup] request failed; retrying (${attempt}/${maxAttempts}).`);
      await delay(retryDelayMs * attempt);
    }
  }
  throw new Error("Cleanup request failed.");
}

export async function runStorageCleanup({
  configuration,
  options,
  fetchImpl = fetch,
  logger = console,
}) {
  if (options.check) {
    logger.log("[storage-cleanup] configuration is ready; no cleanup request was sent.");
    return { ok: true, checked: true };
  }

  const totals = { staleUploadsQueued: 0, claimed: 0, completed: 0, deletedObjects: 0, failed: 0 };
  let possibleBacklog = false;
  let batches = 0;
  for (let batch = 1; batch <= options.maxBatches; batch += 1) {
    const result = await invokeBatch({
      ...configuration,
      limit: options.limit,
      timeoutMs: options.timeoutMs,
      retryDelayMs: options.retryDelayMs,
      fetchImpl,
      logger,
    });
    batches = batch;
    for (const key of Object.keys(totals)) totals[key] += result[key];
    logger.log(
      `[storage-cleanup] batch ${batch}: queued=${result.staleUploadsQueued}, claimed=${result.claimed}, ` +
      `completed=${result.completed}, objects=${result.deletedObjects}, failed=${result.failed}.`,
    );
    if (result.claimed < options.limit) {
      possibleBacklog = false;
      break;
    }
    possibleBacklog = batch === options.maxBatches;
  }

  logger.log(
    `[storage-cleanup] total: batches=${batches}, queued=${totals.staleUploadsQueued}, ` +
    `claimed=${totals.claimed}, completed=${totals.completed}, objects=${totals.deletedObjects}, failed=${totals.failed}.`,
  );
  if (totals.failed > 0) throw new Error(`${totals.failed} cleanup job(s) failed.`);
  if (possibleBacklog) {
    throw new Error(`Cleanup reached the ${options.maxBatches}-batch safety cap; due jobs may remain.`);
  }
  return { ok: true, checked: false, batches, totals };
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  try {
    const options = parseArguments(argv);
    const configuration = readConfiguration(environment);
    await runStorageCleanup({ configuration, options });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage cleanup failed.";
    console.error(`[storage-cleanup] ${message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
