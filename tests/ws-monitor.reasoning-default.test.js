import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { wsMonitorTesting } from "../wecom/ws-monitor.js";

const { ensureDefaultSessionReasoningLevel } = wsMonitorTesting;

describe("ensureDefaultSessionReasoningLevel", () => {
  it("initializes missing reasoningLevel to stream", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wecom-reasoning-default-"));
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:wecom-dm-lirui:direct:lirui";
    await writeFile(storePath, `${JSON.stringify({
      [sessionKey]: {
        sessionId: "session-1",
        updatedAt: Date.now(),
      },
    }, null, 2)}\n`);

    const core = {
      session: {
        async recordSessionMetaFromInbound() {
          return { sessionId: "session-1", updatedAt: Date.now() };
        },
      },
    };

    await ensureDefaultSessionReasoningLevel({
      core,
      storePath,
      sessionKey,
      ctx: { SessionKey: sessionKey },
      channelTag: "TEST",
    });

    const store = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(store[sessionKey].reasoningLevel, "stream");
  });

  it("does not overwrite an existing reasoningLevel", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wecom-reasoning-default-"));
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:wecom-dm-lirui:direct:lirui";
    await writeFile(storePath, `${JSON.stringify({
      [sessionKey]: {
        sessionId: "session-1",
        updatedAt: Date.now(),
        reasoningLevel: "off",
      },
    }, null, 2)}\n`);

    const core = {
      session: {
        async recordSessionMetaFromInbound() {
          return { sessionId: "session-1", updatedAt: Date.now(), reasoningLevel: "off" };
        },
      },
    };

    await ensureDefaultSessionReasoningLevel({
      core,
      storePath,
      sessionKey,
      ctx: { SessionKey: sessionKey },
      channelTag: "TEST",
    });

    const store = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(store[sessionKey].reasoningLevel, "off");
  });
});
