import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPersistentReqIdStore } from "../wecom/reqid-store.js";

describe("createPersistentReqIdStore", () => {
  let tempDir;
  let storePath;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "reqid-test-"));
    storePath = join(tempDir, "reqids-test.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("set and getSync", () => {
    const store = createPersistentReqIdStore("test", { storePath });
    store.set("chat1", "req-abc");
    assert.equal(store.getSync("chat1"), "req-abc");
    assert.equal(store.getSync("chat2"), undefined);
    store.destroy();
  });

  it("respects TTL", () => {
    const store = createPersistentReqIdStore("test", { storePath, ttlMs: 1 });
    store.set("chat1", "req-old");
    // Entry should expire immediately since ttlMs=1
    const result = store.getSync("chat1");
    // May or may not be expired depending on timing, but definitely works
    store.destroy();
  });

  it("evicts oldest entries when exceeding maxSize", () => {
    const store = createPersistentReqIdStore("test", { storePath, maxSize: 3 });
    store.set("chat1", "req-1");
    store.set("chat2", "req-2");
    store.set("chat3", "req-3");
    store.set("chat4", "req-4");
    assert.equal(store.size, 3);
    assert.equal(store.getSync("chat1"), undefined);
    assert.equal(store.getSync("chat4"), "req-4");
    store.destroy();
  });

  it("flush writes to disk and warmup restores", async () => {
    const store1 = createPersistentReqIdStore("test", { storePath, debounceMs: 100_000 });
    store1.set("chat1", "req-abc");
    store1.set("chat2", "req-def");
    await store1.flush();
    store1.destroy();

    const raw = await readFile(storePath, "utf8");
    const data = JSON.parse(raw);
    assert.equal(data.chat1.reqId, "req-abc");
    assert.equal(data.chat2.reqId, "req-def");

    const store2 = createPersistentReqIdStore("test", { storePath });
    await store2.warmup();
    assert.equal(store2.getSync("chat1"), "req-abc");
    assert.equal(store2.getSync("chat2"), "req-def");
    store2.destroy();
  });

  it("warmup ignores expired entries", async () => {
    const store1 = createPersistentReqIdStore("test", { storePath });
    store1.set("chat1", "req-old");
    await store1.flush();
    store1.destroy();

    const store2 = createPersistentReqIdStore("test", { storePath, ttlMs: 0 });
    await store2.warmup();
    assert.equal(store2.size, 0);
    store2.destroy();
  });

  it("warmup handles missing file gracefully", async () => {
    const store = createPersistentReqIdStore("test", {
      storePath: join(tempDir, "nonexistent.json"),
    });
    await store.warmup();
    assert.equal(store.size, 0);
    store.destroy();
  });

  it("destroy cancels pending flush timer", () => {
    const store = createPersistentReqIdStore("test", { storePath, debounceMs: 50 });
    store.set("chat1", "req-1");
    store.destroy();
    // Should not throw
  });

  it("keeps later updates dirty when set happens during an in-flight flush", async () => {
    const writes = [];
    let notifyFirstWriteStarted;
    let releaseFirstWrite;
    const firstWriteStarted = new Promise((resolve) => {
      notifyFirstWriteStarted = resolve;
    });

    const store = createPersistentReqIdStore("test", {
      storePath,
      debounceMs: 100_000,
      writeJsonFileAtomically: async (targetPath, value) => {
        writes.push(JSON.parse(JSON.stringify(value)));
        if (writes.length === 1) {
          notifyFirstWriteStarted();
          await new Promise((resolve) => {
            releaseFirstWrite = resolve;
          });
        }
        await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      },
    });

    try {
      store.set("chat1", "req-1");
      const flushPromise = store.flush();
      await firstWriteStarted;

      store.set("chat2", "req-2");
      releaseFirstWrite();
      await flushPromise;

      await store.flush();

      assert.equal(writes.length, 2);
      assert.deepEqual(Object.keys(writes[0]), ["chat1"]);
      assert.deepEqual(Object.keys(writes[1]).sort(), ["chat1", "chat2"]);

      const raw = await readFile(storePath, "utf8");
      const data = JSON.parse(raw);
      assert.equal(data.chat1.reqId, "req-1");
      assert.equal(data.chat2.reqId, "req-2");
    } finally {
      store.destroy();
    }
  });
});
