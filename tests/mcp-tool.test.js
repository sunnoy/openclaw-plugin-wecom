import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createWeComMcpTool, mcpToolTesting } from "../wecom/mcp-tool.js";
import {
  getSessionChatInfo,
  resetStateForTesting,
  setOpenclawConfig,
  setRuntime,
  setSessionChatInfo,
} from "../wecom/state.js";
import { setWsClient, resetWsStateForTesting } from "../wecom/ws-state.js";

describe("wecom_mcp tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mcpToolTesting.resetCaches();
    resetStateForTesting();
    setOpenclawConfig({});
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    mcpToolTesting.resetCaches();
    resetStateForTesting();
    await resetWsStateForTesting();
  });

  it("lists tools and cleans unsupported schema fields", async () => {
    const tool = createWeComMcpTool();
    const wsCalls = [];
    setWsClient("default", {
      isConnected: true,
      async reply(frame, body, command) {
        wsCalls.push({ frame, body, command });
        return {
          errcode: 0,
          body: {
            url: "https://mcp.example.invalid/contact",
          },
        };
      },
    });

    const fetchCalls = [];
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({
        url,
        headers: Object.fromEntries(new Headers(options.headers).entries()),
        body: JSON.parse(options.body),
      });

      const method = fetchCalls.at(-1).body.method;
      if (method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: {} }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "mcp-session-id": "sess-1",
          },
        });
      }
      if (method === "notifications/initialized") {
        return new Response(null, {
          status: 204,
          headers: {
            "mcp-session-id": "sess-1",
          },
        });
      }
      if (method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "2",
            result: {
              tools: [
                {
                  name: "get_userlist",
                  description: "List visible contacts",
                  inputSchema: {
                    type: "object",
                    additionalProperties: false,
                    $defs: {
                      payload: {
                        type: "object",
                        properties: {
                          keyword: { type: "string", format: "email" },
                        },
                      },
                    },
                    properties: {
                      payload: { $ref: "#/$defs/payload" },
                    },
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      throw new Error(`unexpected MCP method: ${method}`);
    };

    const result = await tool.execute("tool-1", {
      action: "list",
      category: "contact",
    });

    assert.equal(wsCalls.length, 1);
    assert.equal(wsCalls[0].body.biz_type, "contact");
    assert.equal(wsCalls[0].body.plugin_version, mcpToolTesting.OFFICIAL_WECOM_PLUGIN_VERSION);
    assert.equal(wsCalls[0].command, "aibot_get_mcp_config");

    assert.ok(fetchCalls.length >= 2);
    assert.ok(fetchCalls.some((call) => call.body.method === "tools/list"));
    const toolListCall = fetchCalls.find((call) => call.body.method === "tools/list");
    if (toolListCall.headers["mcp-session-id"] !== undefined) {
      assert.equal(toolListCall.headers["mcp-session-id"], "sess-1");
    }

    const payload = JSON.parse(result.content[0].text);
    assert.equal(result.details.accountId, "default");
    assert.equal(payload.accountId, "default");
    assert.equal(payload.category, "contact");
    assert.equal(payload.tools[0].name, "get_userlist");
    assert.deepEqual(payload.tools[0].inputSchema, {
      type: "object",
      properties: {
        payload: {
          type: "object",
          properties: {
            keyword: { type: "string" },
          },
        },
      },
    });
  });

  it("falls back to a websocket-capable account when the configured default cannot fetch MCP config", async () => {
    setOpenclawConfig({
      channels: {
        wecom: {
          defaultAccount: "agentOnly",
          agentOnly: {
            agent: {
              corpId: "corp",
              corpSecret: "agent-secret",
              agentId: 100001,
            },
          },
          mcpBot: {
            botId: "bot-id",
            secret: "bot-secret",
          },
        },
      },
    });

    const tool = createWeComMcpTool();
    const wsCalls = [];
    setWsClient("mcpbot", {
      isConnected: true,
      async reply(frame, body, command) {
        wsCalls.push({ frame, body, command });
        return {
          errcode: 0,
          body: { url: "https://mcp.example.invalid/doc" },
        };
      },
    });

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (body.method === "tools/list") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected MCP method: ${body.method}`);
    };

    const result = await tool.execute("tool-account-fallback", {
      action: "list",
      category: "doc",
    });

    assert.equal(wsCalls.length, 1);
    assert.equal(wsCalls[0].command, "aibot_get_mcp_config");
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.accountId, "mcpbot");
  });

  it("returns a structured error for invalid JSON args", async () => {
    const tool = createWeComMcpTool();

    const result = await tool.execute("tool-2", {
      action: "call",
      category: "schedule",
      method: "create_schedule",
      args: "{",
    });

    const payload = JSON.parse(result.content[0].text);
    assert.match(payload.error, /args is not valid JSON/);
  });

  it("normalizes unsupported biz type errors into category guidance", async () => {
    const tool = createWeComMcpTool();
    setWsClient("default", {
      isConnected: true,
      async reply() {
        return {
          errcode: 846609,
          errmsg: "unsupported mcp biz type",
        };
      },
    });

    const result = await tool.execute("tool-3", {
      action: "list",
      category: "schedule",
    });

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.errcode, 846609);
    assert.equal(payload.category, "schedule");
    assert.equal(payload.unsupportedCategory, true);
    assert.match(payload.error, /category "schedule" is not enabled/i);
    assert.match(payload.next_action, /Stop retrying category "schedule"/);
  });

  it("passes requester userid header to MCP calls", async () => {
    const tool = createWeComMcpTool({
      accountId: "acct-a",
      requesterUserId: "lirui",
    });

    setWsClient("acct-a", {
      isConnected: true,
      async reply() {
        return {
          errcode: 0,
          body: { url: "https://mcp.example.invalid/doc" },
        };
      },
    });

    const fetchCalls = [];
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      fetchCalls.push({
        body,
        headers: Object.fromEntries(new Headers(options.headers).entries()),
      });

      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "sess-user" },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, {
          status: 204,
          headers: { "mcp-session-id": "sess-user" },
        });
      }
      if (body.method === "tools/list") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected MCP method: ${body.method}`);
    };

    await tool.execute("tool-4", {
      action: "list",
      category: "doc",
    });

    assert.ok(fetchCalls.length >= 2);
    assert.ok(fetchCalls.every((call) => call.headers["x-openclaw-wecom-userid"] === "lirui"));
  });

  it("sends a doc auth biz message when MCP returns a document auth error", async () => {
    const tool = createWeComMcpTool({
      accountId: "default",
      requesterUserId: "lirui",
      chatId: "WrMixedCaseChat",
      chatType: "group",
    });
    const wsCalls = [];
    setWsClient("default", {
      isConnected: true,
      async reply(frame, body, command) {
        wsCalls.push({ frame, body, command });
        if (command === "aibot_get_mcp_config") {
          return {
            errcode: 0,
            body: { url: "https://mcp.example.invalid/doc" },
          };
        }
        return { errcode: 0 };
      },
    });

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "sess-auth" },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, {
          status: 204,
          headers: { "mcp-session-id": "sess-auth" },
        });
      }
      if (body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: JSON.stringify({ errcode: 851013, errmsg: "need auth" }) }],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected MCP method: ${body.method}`);
    };

    const result = await tool.execute("tool-5", {
      action: "call",
      category: "doc",
      method: "get_doc_content",
      args: { docid: "doc-1", type: 2 },
    });

    const bizMsgCall = wsCalls.find((call) => call.command === "aibot_send_biz_msg");
    assert.ok(bizMsgCall);
    assert.equal(bizMsgCall.body.biz_type, 1);
    assert.equal(bizMsgCall.body.chat_id, "WrMixedCaseChat");
    assert.equal(bizMsgCall.body.userid, "lirui");
    assert.equal(bizMsgCall.body.chat_type, 2);

    const payload = JSON.parse(result.content[0].text);
    const inner = JSON.parse(payload.content[0].text);
    assert.equal(inner.errcode, 851013);
    assert.equal(inner._biz_msg_sent, true);
  });

  it("resolves smartpage_create page_filepath before calling MCP", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wecom-mcp-smartpage-"));
    try {
      const pagePath = path.join(dir, "page.md");
      await writeFile(pagePath, "# Page\n\ncontent\n");
      const tool = createWeComMcpTool();
      setWsClient("default", {
        isConnected: true,
        async reply() {
          return {
            errcode: 0,
            body: { url: "https://mcp.example.invalid/doc" },
          };
        },
      });

      let toolCallArgs;
      globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "tools/call") {
          toolCallArgs = body.params.arguments;
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [{ type: "text", text: JSON.stringify({ errcode: 0, errmsg: "ok" }) }],
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`unexpected MCP method: ${body.method}`);
      };

      await tool.execute("tool-6", {
        action: "call",
        category: "doc",
        method: "smartpage_create",
        args: {
          title: "SmartPage",
          pages: [{ page_title: "Page", page_filepath: pagePath, content_type: "markdown" }],
        },
      });

      assert.equal(toolCallArgs.pages[0].page_content, "# Page\n\ncontent\n");
      assert.equal("page_filepath" in toolCallArgs.pages[0], false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores smartpage export content as a local media file", async () => {
    const saved = [];
    setRuntime({
      media: {
        async saveMediaBuffer(buffer, contentType, direction, maxBytes, filename) {
          saved.push({ buffer, contentType, direction, maxBytes, filename });
          return { path: `/tmp/${filename}`, contentType };
        },
      },
    });

    const tool = createWeComMcpTool();
    setWsClient("default", {
      isConnected: true,
      async reply() {
        return {
          errcode: 0,
          body: { url: "https://mcp.example.invalid/doc" },
        };
      },
    });

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify({ errcode: 0, task_done: true, content: "# Export\n" }),
              }],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected MCP method: ${body.method}`);
    };

    const result = await tool.execute("tool-7", {
      action: "call",
      category: "doc",
      method: "smartpage_get_export_result",
      args: { task_id: "task-1" },
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].buffer.toString("utf8"), "# Export\n");
    assert.equal(saved[0].contentType, "text/markdown");
    assert.equal(saved[0].filename, "smartpage_export.md");
    const payload = JSON.parse(result.content[0].text);
    const inner = JSON.parse(payload.content[0].text);
    assert.equal(inner.content_path, "/tmp/smartpage_export.md");
    assert.equal(inner.content, undefined);
  });

  it("bounds session chat info while preserving original-case chat ids", () => {
    for (let index = 0; index <= 5000; index += 1) {
      setSessionChatInfo(`session-${index}`, {
        chatId: `WrMixedCaseChat${index}`,
        chatType: "group",
      });
    }

    assert.equal(getSessionChatInfo("session-0"), undefined);
    assert.deepEqual(getSessionChatInfo("session-5000"), {
      chatId: "WrMixedCaseChat5000",
      chatType: "group",
    });
  });
});
