/**
 * Utility helpers for the WeCom plugin.
 */
export class TTLCache {
  options;
  cache = new Map();
  checkPeriod;
  cleanupTimer;
  constructor(options) {
    this.options = options;
    this.checkPeriod = options.checkPeriod || options.ttl;
    this.startCleanup();
  }
  set(key, value, ttl) {
    const expiresAt = Date.now() + (ttl || this.options.ttl);
    this.cache.set(key, { value, expiresAt });
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }
  has(key) {
    return this.get(key) !== undefined;
  }
  delete(key) {
    return this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
  }
  size() {
    this.cleanup();
    return this.cache.size;
  }
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.checkPeriod);
    // Don't prevent process from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cache.clear();
  }
}
// ============================================================================
// Message deduplication
// ============================================================================
export class MessageDeduplicator {
  seen = new TTLCache({ ttl: 300000 }); // 5 minutes
  isDuplicate(msgId) {
    if (this.seen.has(msgId)) {
      return true;
    }
    this.seen.set(msgId, true);
    return false;
  }
  markAsSeen(msgId) {
    this.seen.set(msgId, true);
  }
}
// ============================================================================
// Text chunking for WeCom Agent API (2048-byte limit per message)
// ============================================================================
const AGENT_TEXT_BYTE_LIMIT = 2000; // safe margin below 2048

/**
 * Split a string into chunks that each fit within a byte limit (UTF-8).
 * Splits at newline boundaries when possible, otherwise at character boundaries.
 */
export function splitTextByByteLimit(text, limit = AGENT_TEXT_BYTE_LIMIT) {
  if (Buffer.byteLength(text, "utf8") <= limit) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (Buffer.byteLength(remaining, "utf8") <= limit) {
      chunks.push(remaining);
      break;
    }

    // Binary search for the max char index that fits within the byte limit.
    let lo = 0;
    let hi = remaining.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (Buffer.byteLength(remaining.slice(0, mid), "utf8") <= limit) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    let splitAt = lo;

    // Prefer splitting at a newline boundary within the last 20% of the chunk.
    const searchStart = Math.max(0, Math.floor(splitAt * 0.8));
    const lastNewline = remaining.lastIndexOf("\n", splitAt - 1);
    if (lastNewline >= searchStart) {
      splitAt = lastNewline + 1;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

// ============================================================================
// Constants
// ============================================================================
export const CONSTANTS = {
  // AES/Crypto
  AES_BLOCK_SIZE: 32,
  AES_KEY_LENGTH: 43,
};
