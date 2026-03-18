import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createWeComMcpTool, mcpToolTesting } from "../wecom/mcp-tool.js";
import { setOpenclawConfig, resetStateForTesting } from "../wecom/state.js";
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
    assert.equal(wsCalls[0].body.plugin_version, "1.0.12");
    assert.equal(wsCalls[0].command, "aibot_get_mcp_config");

    assert.ok(fetchCalls.length >= 2);
    assert.ok(fetchCalls.some((call) => call.body.method === "tools/list"));
    const toolListCall = fetchCalls.find((call) => call.body.method === "tools/list");
    if (toolListCall.headers["mcp-session-id"] !== undefined) {
      assert.equal(toolListCall.headers["mcp-session-id"], "sess-1");
    }

    const payload = JSON.parse(result.content[0].text);
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
});
