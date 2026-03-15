import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { logger } from "../logger.js";
import { REQID_TTL_MS, REQID_MAX_SIZE, REQID_FLUSH_DEBOUNCE_MS } from "./constants.js";
import { resolveStateDir } from "./openclaw-compat.js";

function getStorePath(accountId) {
  return path.join(resolveStateDir(), "wecomConfig", `reqids-${accountId}.json`);
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function writeJsonFileAtomically(filePath, value) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export function createPersistentReqIdStore(accountId, options = {}) {
  const maxSize = options.maxSize ?? REQID_MAX_SIZE;
  const ttlMs = options.ttlMs ?? REQID_TTL_MS;
  const debounceMs = options.debounceMs ?? REQID_FLUSH_DEBOUNCE_MS;
  const storePath = options.storePath ?? getStorePath(accountId);
  const writeJson = options.writeJsonFileAtomically ?? writeJsonFileAtomically;
  const cache = new Map();
  let dirty = false;
  let dirtyVersion = 0;
  let flushTimer = null;
  let flushPromise = null;

  function evictOldest() {
    if (cache.size <= maxSize) return;
    const entries = [...cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const toRemove = entries.length - maxSize;
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0]);
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      try {
        await store.flush();
      } catch (error) {
        logger.warn(`[ReqIdStore:${accountId}] Debounced flush failed: ${error.message}`);
      }
    }, debounceMs);
  }

  const store = {
    set(chatId, reqId) {
      cache.set(chatId, { reqId, updatedAt: Date.now() });
      dirty = true;
      dirtyVersion += 1;
      evictOldest();
      scheduleFlush();
    },

    getSync(chatId) {
      const entry = cache.get(chatId);
      if (!entry) return undefined;
      if (Date.now() - entry.updatedAt > ttlMs) {
        cache.delete(chatId);
        return undefined;
      }
      return entry.reqId;
    },

    async warmup() {
      try {
        const data = await readJsonFile(storePath);
        const now = Date.now();
        for (const [chatId, entry] of Object.entries(data)) {
          if (entry?.reqId && entry?.updatedAt && now - entry.updatedAt <= ttlMs) {
            cache.set(chatId, entry);
          }
        }
        evictOldest();
        logger.info(`[ReqIdStore:${accountId}] Warmed up ${cache.size} entries from ${storePath}`);
      } catch (error) {
        logger.warn(`[ReqIdStore:${accountId}] Warmup failed (non-fatal): ${error.message}`);
      }
    },

    async flush() {
      if (flushPromise) {
        await flushPromise;
        if (!dirty) return;
      }
      if (!dirty) return;
      const currentFlush = (async () => {
        const snapshot = Object.fromEntries(cache);
        const snapshotVersion = dirtyVersion;
        try {
          await writeJson(storePath, snapshot);
          if (dirtyVersion === snapshotVersion) {
            dirty = false;
          } else {
            scheduleFlush();
          }
          logger.debug(`[ReqIdStore:${accountId}] Flushed ${cache.size} entries to disk`);
        } catch (error) {
          // Keep dirty = true so a subsequent set() or scheduled flush can retry
          logger.warn(`[ReqIdStore:${accountId}] Flush failed, will retry on next trigger: ${error.message}`);
          scheduleFlush();
        }
      })();
      flushPromise = currentFlush;
      try {
        await currentFlush;
      } finally {
        if (flushPromise === currentFlush) {
          flushPromise = null;
        }
      }
    },

    destroy() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },

    get size() {
      return cache.size;
    },
  };

  return store;
}

export const reqIdStoreTesting = {
  getStorePath,
};
