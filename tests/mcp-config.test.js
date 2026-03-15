import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchAndSaveMcpConfig, mcpConfigTesting, saveMcpConfig } from "../wecom/mcp-config.js";

class FakeWsClient extends EventEmitter {
  constructor(replyImpl) {
    super();
    this.replyImpl = replyImpl;
    this.replyCalls = [];
  }

  async reply(frame, body, command) {
    this.replyCalls.push({ frame, body, command });
    return this.replyImpl(frame, body, command);
  }
}

describe("mcp config", () => {
  let tempHome;
  let originalHome;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "wecom-mcp-home-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    mcpConfigTesting.resetWriteQueue();
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  });

  it("persists MCP config into ~/.openclaw/wecomConfig/config.json", async () => {
    await saveMcpConfig(
      {
        key: "doc",
        type: "streamable-http",
        url: "https://mcp.example.invalid/doc",
      },
      {},
    );

    const saved = JSON.parse(await readFile(mcpConfigTesting.getWecomConfigPath(), "utf8"));
    assert.deepEqual(saved.mcpConfig.doc, {
      type: "streamable-http",
      url: "https://mcp.example.invalid/doc",
    });
  });

  it("fetches MCP config from WS and saves it using a streamable-http fallback", async () => {
    const logs = [];
    const errors = [];
    const wsClient = new FakeWsClient(async (_frame, body, command) => {
      assert.equal(body.biz_type, "doc");
      assert.equal(command, "aibot_get_mcp_config");
      return {
        errcode: 0,
        body: {
          url: "https://mcp.example.invalid/runtime-doc",
          is_authed: true,
        },
      };
    });

    await fetchAndSaveMcpConfig(wsClient, "default", {
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    });

    assert.equal(errors.length, 0);
    assert.equal(wsClient.replyCalls.length, 1);

    const saved = JSON.parse(await readFile(mcpConfigTesting.getWecomConfigPath(), "utf8"));
    assert.deepEqual(saved.mcpConfig.doc, {
      type: "streamable-http",
      url: "https://mcp.example.invalid/runtime-doc",
    });
    assert.ok(logs.some((message) => message.includes("Fetching MCP config")));
    assert.ok(logs.some((message) => message.includes("MCP config saved")));
  });
});
