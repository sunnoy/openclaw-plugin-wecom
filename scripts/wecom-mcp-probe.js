#!/usr/bin/env node

import { WSClient, generateReqId } from "@wecom/aibot-node-sdk";

const DEFAULT_WS_URL = "wss://qyapi.weixin.qq.com/cgi-bin/assistant/get_ticket";
const DEFAULT_PLUGIN_VERSION = "1.0.12";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_CATEGORIES = ["doc", "contact", "todo", "meeting", "schedule"];
const MCP_GET_CONFIG_CMD = "aibot_get_mcp_config";
const MCP_CONFIG_FETCH_TIMEOUT_MS = 15_000;
const HTTP_REQUEST_TIMEOUT_MS = 30_000;
const UNSUPPORTED_BIZ_TYPE_ERRCODE = 846609;

function parseCliArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      continue;
    }
    const body = raw.slice(2);
    const index = body.indexOf("=");
    if (index === -1) {
      args[body] = "true";
      continue;
    }
    const key = body.slice(0, index);
    const value = body.slice(index + 1);
    args[key] = value;
  }
  return args;
}

function resolveConfig(cliArgs) {
  const botId = String(cliArgs.botId ?? process.env.WECOM_BOT_ID ?? "").trim();
  const secret = String(cliArgs.secret ?? process.env.WECOM_SECRET ?? "").trim();
  const wsUrl = String(cliArgs.wsUrl ?? process.env.WECOM_WS_URL ?? DEFAULT_WS_URL).trim() || DEFAULT_WS_URL;
  const pluginVersion =
    String(cliArgs.pluginVersion ?? process.env.WECOM_PLUGIN_VERSION ?? DEFAULT_PLUGIN_VERSION).trim() ||
    DEFAULT_PLUGIN_VERSION;
  const protocolVersion =
    String(cliArgs.protocolVersion ?? process.env.WECOM_MCP_PROTOCOL_VERSION ?? DEFAULT_PROTOCOL_VERSION).trim() ||
    DEFAULT_PROTOCOL_VERSION;
  const categories = String(cliArgs.categories ?? process.env.WECOM_MCP_CATEGORIES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    botId,
    secret,
    wsUrl,
    pluginVersion,
    protocolVersion,
    categories: categories.length > 0 ? categories : DEFAULT_CATEGORIES,
  };
}

function printUsage() {
  console.error(
    [
      "Usage:",
      "  WECOM_BOT_ID=... WECOM_SECRET=... node scripts/wecom-mcp-probe.js",
      "  node scripts/wecom-mcp-probe.js --botId=... --secret=... [--categories=doc,contact,todo]",
      "",
      "Optional:",
      `  --wsUrl=${DEFAULT_WS_URL}`,
      `  --pluginVersion=${DEFAULT_PLUGIN_VERSION}`,
      `  --protocolVersion=${DEFAULT_PROTOCOL_VERSION}`,
    ].join("\n"),
  );
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function createSdkLogger() {
  return {
    info: (...args) => console.error("[sdk:info]", ...args),
    warn: (...args) => console.error("[sdk:warn]", ...args),
    error: (...args) => console.error("[sdk:error]", ...args),
    debug: (...args) => console.error("[sdk:debug]", ...args),
  };
}

async function waitForAuthenticatedClient({ botId, secret, wsUrl }) {
  const wsClient = new WSClient({
    botId,
    secret,
    wsUrl,
    logger: createSdkLogger(),
  });

  return await new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      wsClient.removeAllListeners("authenticated");
      wsClient.removeAllListeners("error");
      wsClient.removeAllListeners("disconnected");
      wsClient.removeAllListeners("event.disconnected_event");
    };

    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn(value);
    };

    wsClient.on("authenticated", () => settle(resolve, wsClient));
    wsClient.on("error", (error) => settle(reject, error));
    wsClient.on("disconnected", (reason) => {
      settle(reject, new Error(`WS disconnected before auth: ${reason}`));
    });
    wsClient.on("event.disconnected_event", () => {
      settle(reject, new Error("WS disconnected_event received"));
    });

    try {
      wsClient.connect();
    } catch (error) {
      settle(reject, error);
    }
  });
}

async function fetchMcpConfig(wsClient, { category, pluginVersion }) {
  const reqId = generateReqId("mcp_probe");
  const response = await withTimeout(
    wsClient.reply(
      { headers: { req_id: reqId } },
      { biz_type: category, plugin_version: pluginVersion },
      MCP_GET_CONFIG_CMD,
    ),
    MCP_CONFIG_FETCH_TIMEOUT_MS,
    `Timed out fetching MCP config for category "${category}"`,
  );

  if (response?.errcode !== undefined && response.errcode !== 0) {
    return {
      ok: false,
      stage: "get_mcp_config",
      errcode: response.errcode,
      errmsg: response.errmsg ?? "unknown",
      category,
    };
  }

  if (!response?.body?.url) {
    return {
      ok: false,
      stage: "get_mcp_config",
      errcode: -1,
      errmsg: "missing url in response body",
      category,
    };
  }

  return {
    ok: true,
    category,
    url: response.body.url,
    transportType:
      response.body.transport_type ??
      response.body.transportType ??
      response.body.config_type ??
      response.body.configType ??
      response.body.type ??
      "streamable-http",
    isAuthed: response.body.is_authed,
  };
}

async function parseSseResponse(response) {
  const text = await response.text();
  const lines = text.split("\n");
  let currentDataParts = [];
  let lastEventData = "";

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      currentDataParts.push(line.slice(6));
      continue;
    }
    if (line.startsWith("data:")) {
      currentDataParts.push(line.slice(5));
      continue;
    }
    if (line.trim() === "" && currentDataParts.length > 0) {
      lastEventData = currentDataParts.join("\n").trim();
      currentDataParts = [];
    }
  }

  if (currentDataParts.length > 0) {
    lastEventData = currentDataParts.join("\n").trim();
  }

  if (!lastEventData) {
    throw new Error("SSE response did not contain usable data");
  }

  const rpc = JSON.parse(lastEventData);
  if (rpc.error) {
    const error = new Error(rpc.error.message ?? "MCP RPC error");
    error.code = rpc.error.code;
    error.data = rpc.error.data;
    throw error;
  }
  return rpc.result;
}

async function sendRawJsonRpc(url, sessionId, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_REQUEST_TIMEOUT_MS);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const newSessionId = response.headers.get("mcp-session-id");
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} ${response.statusText}`);
      error.statusCode = response.status;
      throw error;
    }

    const contentLength = response.headers.get("content-length");
    if (response.status === 204 || contentLength === "0") {
      return { result: undefined, sessionId: newSessionId ?? sessionId };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const result = contentType.includes("text/event-stream")
      ? await parseSseResponse(response)
      : await response.json().then((rpc) => {
          if (rpc.error) {
            const error = new Error(rpc.error.message ?? "MCP RPC error");
            error.code = rpc.error.code;
            error.data = rpc.error.data;
            throw error;
          }
          return rpc.result;
        });

    return { result, sessionId: newSessionId ?? sessionId };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function listTools(url, protocolVersion) {
  let sessionId = null;

  const init = await sendRawJsonRpc(url, sessionId, {
    jsonrpc: "2.0",
    id: generateReqId("mcp_init"),
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "wecom_mcp_probe", version: "1.0.0" },
    },
  });
  sessionId = init.sessionId;

  const initialized = await sendRawJsonRpc(url, sessionId, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  sessionId = initialized.sessionId;

  const listed = await sendRawJsonRpc(url, sessionId, {
    jsonrpc: "2.0",
    id: generateReqId("mcp_list"),
    method: "tools/list",
  });

  return listed.result?.tools ?? [];
}

function normalizeUnsupported(result, category) {
  const errcode = Number(result?.errcode);
  const rawMessage =
    typeof result?.error === "string"
      ? result.error
      : typeof result?.errmsg === "string"
        ? result.errmsg
        : "";
  return errcode === UNSUPPORTED_BIZ_TYPE_ERRCODE || /unsupported mcp biz type/i.test(rawMessage)
    ? {
        ok: false,
        category,
        stage: "tools/list",
        errcode: UNSUPPORTED_BIZ_TYPE_ERRCODE,
        errmsg: rawMessage || `unsupported mcp biz type for category "${category}"`,
      }
    : null;
}

async function probeCategory(wsClient, config, category) {
  const mcpConfig = await fetchMcpConfig(wsClient, {
    category,
    pluginVersion: config.pluginVersion,
  });
  if (!mcpConfig.ok) {
    return mcpConfig;
  }

  try {
    const tools = await listTools(mcpConfig.url, config.protocolVersion);
    const unsupported = normalizeUnsupported(tools, category);
    if (unsupported) {
      return unsupported;
    }
    return {
      ok: true,
      category,
      url: mcpConfig.url,
      transportType: mcpConfig.transportType,
      isAuthed: mcpConfig.isAuthed,
      toolCount: tools.length,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
      })),
    };
  } catch (error) {
    return {
      ok: false,
      category,
      stage: "tools/list",
      errcode: error.code ?? error.statusCode ?? -1,
      errmsg: error.message,
    };
  }
}

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const config = resolveConfig(cliArgs);
  if (!config.botId || !config.secret) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const wsClient = await waitForAuthenticatedClient(config);
  const results = [];

  try {
    for (const category of config.categories) {
      results.push(await probeCategory(wsClient, config, category));
    }
  } finally {
    try {
      wsClient.disconnect();
    } catch {
      // Ignore disconnect failures on exit.
    }
  }

  console.log(JSON.stringify({ ok: true, categories: results }, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "bootstrap",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
