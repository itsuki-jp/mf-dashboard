import { timingSafeEqual } from "node:crypto";
import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCrawlerProgressReporter } from "./crawler-progress.js";
import {
  acquireCrawlerRunLock,
  CrawlerAlreadyRunningError,
  getCrawlerRunLockPath,
  getCrawlerRunState,
  type CrawlerRunState,
} from "./crawler-run-lock.js";
import { getCrawlerRunStatePath } from "./crawler-run-state.js";
import { error, info } from "./logger.js";
import { assertValidProfileId } from "./profile-config.js";

const DEFAULT_PORT = 8766;
const DEFAULT_HOST = "127.0.0.1";

interface CrawlerTriggerServerOptions {
  getState?: () => Promise<CrawlerRunState>;
  startRun?: (profileId?: string, history?: boolean) => Promise<CrawlerRunState>;
  watchState?: (onChange: () => void, onError: (err: Error) => void) => Promise<() => void>;
}

const MAX_RUN_REQUEST_BYTES = 1_024;

async function readRequestedRun(
  request: IncomingMessage,
): Promise<{ profileId?: string; history: boolean }> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > MAX_RUN_REQUEST_BYTES) {
      throw new Error("invalid profile selection");
    }
  }
  if (!body.trim()) return { history: false };

  const value: unknown = JSON.parse(body);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid profile selection");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "profileId" && key !== "history") ||
    ("profileId" in record && typeof record.profileId !== "string") ||
    ("history" in record && typeof record.history !== "boolean")
  ) {
    throw new Error("invalid profile selection");
  }

  const profileId = typeof record.profileId === "string" ? record.profileId : undefined;
  const history = typeof record.history === "boolean" ? record.history : false;
  if (profileId !== undefined) assertValidProfileId(profileId);
  return {
    ...(profileId ? { profileId } : {}),
    history,
  };
}

type ProgressReporter = Awaited<ReturnType<typeof createCrawlerProgressReporter>>;

export async function recordManualRunFailure(progress: ProgressReporter): Promise<void> {
  try {
    await progress.finish("failed");
  } catch (err) {
    error("Failed to record manual crawler failure:", err);
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function methodNotAllowed(response: ServerResponse): void {
  response.writeHead(405, { allow: "GET, POST" });
  response.end();
}

function hasValidRefreshToken(request: IncomingMessage): boolean {
  const expectedToken = process.env.REFRESH_TOKEN;
  const authorization = request.headers.authorization;
  if (!expectedToken || !authorization?.startsWith("Bearer ")) return false;

  const suppliedToken = authorization.slice("Bearer ".length);
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

async function watchCrawlerState(
  onChange: () => void,
  onError: (err: Error) => void,
): Promise<() => void> {
  const statePath = process.env.CRAWLER_STATE_PATH ?? getCrawlerRunStatePath();
  const lockPath = getCrawlerRunLockPath();
  const watchedPaths = [statePath, lockPath];
  const targetsByDirectory = new Map<string, string[]>();
  for (const filePath of watchedPaths) {
    const directory = path.dirname(filePath);
    targetsByDirectory.set(directory, [...(targetsByDirectory.get(directory) ?? []), filePath]);
  }
  await Promise.all(
    [...targetsByDirectory.keys()].map((directory) => mkdir(directory, { recursive: true })),
  );
  const watchers: ReturnType<typeof watch>[] = [];
  const closeWatchers = () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
  const handleError = (err: Error) => {
    closeWatchers();
    onError(err);
  };

  try {
    for (const [directory, targets] of targetsByDirectory) {
      const filenames = new Set(targets.map((target) => path.basename(target)));
      const lockFilename = path.basename(lockPath);
      const watcher = watch(directory, (_event, filename) => {
        const changedFilename = filename?.toString();
        if (
          !changedFilename ||
          filenames.has(changedFilename) ||
          changedFilename.startsWith(`${lockFilename}.mutation-`)
        ) {
          onChange();
        }
      });
      watcher.once("error", handleError);
      watchers.push(watcher);
    }
  } catch (err) {
    closeWatchers();
    throw err;
  }

  return closeWatchers;
}

async function streamCrawlerState(
  request: IncomingMessage,
  response: ServerResponse,
  getState: () => Promise<CrawlerRunState>,
  watchState: (onChange: () => void, onError: (err: Error) => void) => Promise<() => void>,
): Promise<void> {
  let closed = false;
  let stopWatching: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let requestedVersion = 0;
  let sentVersion = -1;
  let sending = false;

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    stopWatching?.();
  };
  request.once("close", close);
  response.once("close", close);

  async function sendLatestState(): Promise<void> {
    requestedVersion += 1;
    if (sending) return;

    sending = true;
    try {
      while (!closed && sentVersion !== requestedVersion) {
        const version = requestedVersion;
        const state = await getState();
        if (!closed) {
          response.write(`data: ${JSON.stringify(state)}\n\n`);
          sentVersion = version;
        }
      }
    } finally {
      sending = false;
    }
  }

  const stopWatcher = await watchState(
    () => {
      void sendLatestState().catch((err) => {
        error("Failed to stream crawler state:", err);
        response.destroy(err instanceof Error ? err : undefined);
      });
    },
    (err) => {
      error("Failed to stream crawler state:", err);
      response.destroy(err);
    },
  );
  if (closed) {
    stopWatcher();
    return;
  }
  stopWatching = stopWatcher;
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  response.flushHeaders();
  heartbeat = setInterval(() => {
    if (!closed) response.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();

  try {
    await sendLatestState();
  } catch (err) {
    error("Failed to stream initial crawler state:", err);
    close();
    response.destroy(err instanceof Error ? err : undefined);
  }
}

export async function startCrawlerRun(
  profileId?: string,
  history = false,
): Promise<CrawlerRunState> {
  const lock = await acquireCrawlerRunLock("manual");
  let progress: Awaited<ReturnType<typeof createCrawlerProgressReporter>>;
  try {
    progress = await createCrawlerProgressReporter(
      process.env.CRAWLER_STATE_PATH ?? getCrawlerRunStatePath(),
      lock.record,
      { onUpdate: lock.refreshLease },
    );
  } catch (err) {
    await lock.release();
    throw err;
  }

  void (async () => {
    try {
      const { runCrawler } = await import("./run.js");
      await runCrawler(progress, { profileId, history });
      await progress.finish("success");
    } catch (err) {
      await recordManualRunFailure(progress);
      error("Manual crawler run failed:", err);
    } finally {
      await lock.release();
    }
  })().catch((err) => {
    error("Manual crawler run finalization failed:", err);
  });

  return { ...progress.getState(), running: true, pid: lock.record.pid };
}

export function createCrawlerTriggerServer(options: CrawlerTriggerServerOptions = {}): Server {
  const getState = options.getState ?? getCrawlerRunState;
  const startRun = options.startRun ?? startCrawlerRun;
  const watchState = options.watchState ?? watchCrawlerState;

  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/status") {
        if (request.method !== "GET") {
          methodNotAllowed(response);
          return;
        }
        if (!hasValidRefreshToken(request)) {
          json(response, 401, { error: "unauthorized" });
          return;
        }

        json(response, 200, await getState());
        return;
      }

      if (url.pathname === "/events") {
        if (request.method !== "GET") {
          methodNotAllowed(response);
          return;
        }
        if (!hasValidRefreshToken(request)) {
          json(response, 401, { error: "unauthorized" });
          return;
        }

        await streamCrawlerState(request, response, getState, watchState);
        return;
      }

      if (url.pathname === "/runs") {
        if (request.method !== "POST") {
          methodNotAllowed(response);
          return;
        }
        if (!hasValidRefreshToken(request)) {
          json(response, 401, { error: "unauthorized" });
          return;
        }

        let requestedRun: Awaited<ReturnType<typeof readRequestedRun>>;
        try {
          requestedRun = await readRequestedRun(request);
        } catch {
          json(response, 400, { error: "invalid profile selection" });
          return;
        }

        try {
          json(
            response,
            202,
            requestedRun.history
              ? await startRun(requestedRun.profileId, true)
              : await startRun(requestedRun.profileId),
          );
        } catch (err) {
          if (err instanceof CrawlerAlreadyRunningError) {
            json(response, 409, err.state);
            return;
          }

          throw err;
        }
        return;
      }

      json(response, 404, { error: "not found" });
    } catch (err) {
      error("Crawler trigger request failed:", err);
      json(response, 500, { error: "internal server error" });
      return;
    }
  });
}

export function listenCrawlerTriggerServer(port = DEFAULT_PORT, host = DEFAULT_HOST): Server {
  const server = createCrawlerTriggerServer();
  server.listen(port, host, () => {
    info(`Crawler trigger server listening on ${host}:${port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  listenCrawlerTriggerServer(
    Number(process.env.CRAWLER_PORT) || DEFAULT_PORT,
    process.env.CRAWLER_HOST?.trim() || DEFAULT_HOST,
  );
}
