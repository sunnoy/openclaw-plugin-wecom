#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const DEFAULT_HOST = "ali-ai";
const DEFAULT_CATEGORIES = ["doc", "contact", "todo", "meeting", "schedule", "msg"];

const REMOTE_NODE = String.raw`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { WSClient, generateReqId } from "@wecom/aibot-node-sdk";

const DEFAULT_WS_URL = "wss://qyapi.weixin.qq.com/cgi-bin/assistant/get_ticket";
const DEFAULT_PLUGIN_VERSION = "2026.4.23";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_CATEGORIES = ["doc", "contact", "todo", "meeting", "schedule", "msg"];
const DEFAULT_ACCOUNT_ID = "default";
const MCP_GET_CONFIG_CMD = "aibot_get_mcp_config";
const MCP_CONFIG_FETCH_TIMEOUT_MS = 15000;
const HTTP_REQUEST_TIMEOUT_MS = 30000;
const UNSUPPORTED_BIZ_TYPE_ERRCODE = 846609;
const RESERVED_KEYS = new Set([
  "enabled",
  "name",
  "botId",
  "secret",
  "websocketUrl",
  "sendThinkingMessage",
  "welcomeMessage",
  "welcomeMessagesFile",
  "allowFrom",
  "dmPolicy",
  "groupPolicy",
  "groupAllowFrom",
  "groups",
  "commands",
  "dynamicAgents",
  "dm",
  "groupChat",
  "adminUsers",
  "workspaceTemplate",
  "agent",
  "webhooks",
  "network",
  "defaultAccount",
  "deliveryMode",
  "mediaLocalRoots",
]);
const SHARED_MULTI_ACCOUNT_KEYS = new Set([
  "enabled",
  "websocketUrl",
  "sendThinkingMessage",
  "welcomeMessage",
  "welcomeMessagesFile",
  "allowFrom",
  "dmPolicy",
  "groupPolicy",
  "groupAllowFrom",
  "groups",
  "commands",
  "dynamicAgents",
  "dm",
  "groupChat",
  "adminUsers",
  "workspaceTemplate",
  "agent",
  "webhooks",
  "network",
  "mediaLocalRoots",
]);

function parseCliArgs(argv) {
  const args = {
    categories: DEFAULT_CATEGORIES,
    account: "",
    pluginVersion: "",
    protocolVersion: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--categories" && argv[index + 1]) {
      args.categories = argv[index + 1].split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (current.startsWith("--categories=")) {
      args.categories = current.split("=")[1].split(",").map((item) => item.trim()).filter(Boolean);
      continue;
    }
    if (current === "--account" && argv[index + 1]) {
      args.account = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current.startsWith("--account=")) {
      args.account = current.split("=")[1].trim();
      continue;
    }
    if (current === "--pluginVersion" && argv[index + 1]) {
      args.pluginVersion = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current.startsWith("--pluginVersion=")) {
      args.pluginVersion = current.split("=")[1].trim();
      continue;
    }
    if (current === "--protocolVersion" && argv[index + 1]) {
      args.protocolVersion = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current.startsWith("--protocolVersion=")) {
      args.protocolVersion = current.split("=")[1].trim();
    }
  }
  if (!args.categories.length) {
    args.categories = DEFAULT_CATEGORIES;
  }
  return args;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAccountKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = cloneValue(item);
  }
  return next;
}

function mergeConfig(base, override) {
  const next = isPlainObject(base) ? cloneValue(base) : {};
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined) {
      delete next[key];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = mergeConfig(next[key], value);
      continue;
    }
    next[key] = cloneValue(value);
  }
  return next;
}

function getWecomConfig(config) {
  return isPlainObject(config?.channels?.wecom) ? config.channels.wecom : {};
}

function getAccountEntries(wecom) {
  const entries = [];
  for (const [key, value] of Object.entries(wecom ?? {})) {
    if (RESERVED_KEYS.has(key) || !isPlainObject(value)) {
      continue;
    }
    const accountId = normalizeAccountKey(key);
    if (!accountId) {
      continue;
    }
    entries.push({ key, accountId, value });
  }
  return entries;
}

function hasDictionaryAccounts(wecom) {
  return getAccountEntries(wecom).length > 0;
}

function getSharedMultiAccountConfig(wecom) {
  const shared = {};
  for (const [key, value] of Object.entries(wecom ?? {})) {
    if (SHARED_MULTI_ACCOUNT_KEYS.has(key)) {
      shared[key] = cloneValue(value);
    }
  }
  return shared;
}

function findEntryByAccountId(wecom, accountId) {
  return getAccountEntries(wecom).find((entry) => entry.accountId === accountId) ?? null;
}

function listAccountIds(config) {
  const entries = getAccountEntries(getWecomConfig(config));
  if (!entries.length) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return [...new Set(entries.map((entry) => entry.accountId))].sort((left, right) => left.localeCompare(right));
}

function resolveDefaultAccountId(config) {
  const wecom = getWecomConfig(config);
  const preferred = normalizeAccountKey(wecom.defaultAccount);
  const accountIds = listAccountIds(config);
  if (preferred && accountIds.includes(preferred)) {
    return preferred;
  }
  if (accountIds.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return accountIds[0] ?? DEFAULT_ACCOUNT_ID;
}

function buildAccount(accountId, config) {
  const safeConfig = isPlainObject(config) ? cloneValue(config) : {};
  return {
    accountId,
    botId: String(safeConfig.botId ?? "").trim(),
    secret: String(safeConfig.secret ?? "").trim(),
    websocketUrl: String(safeConfig.websocketUrl ?? "").trim(),
  };
}

function resolveAccount(config, requestedAccountId) {
  const wecom = getWecomConfig(config);
  const accountId = normalizeAccountKey(requestedAccountId) || resolveDefaultAccountId(config);
  if (!hasDictionaryAccounts(wecom)) {
    return buildAccount(DEFAULT_ACCOUNT_ID, wecom);
  }
  const shared = getSharedMultiAccountConfig(wecom);
  const entry = findEntryByAccountId(wecom, accountId);
  if (!entry) {
    return buildAccount(accountId, {});
  }
  return buildAccount(accountId, mergeConfig(shared, entry.value));
}

function isMcpCapableAccount(account) {
  return Boolean(account?.botId && account?.secret);
}

function resolveMcpAccount(config, requestedAccountId) {
  if (requestedAccountId) {
    return resolveAccount(config, requestedAccountId);
  }

  const defaultAccount = resolveAccount(config, resolveDefaultAccountId(config));
  if (isMcpCapableAccount(defaultAccount)) {
    return defaultAccount;
  }

  for (const accountId of listAccountIds(config)) {
    if (accountId === defaultAccount.accountId) {
      continue;
    }
    const account = resolveAccount(config, accountId);
    if (isMcpCapableAccount(account)) {
      return account;
    }
  }

  return defaultAccount;
}

function parseConfigFile(configPath) {
  const raw = fs.readFileSync(configPath, "utf8");
  return vm.runInNewContext("(" + raw + "\n)", Object.create(null), { filename: configPath });
}

function getConfigCandidates() {
  const home = os.homedir();
  const stateDir = String(process.env.OPENCLAW_STATE_DIR ?? "").trim();
  const explicitConfig = String(process.env.OPENCLAW_CONFIG_PATH ?? "").trim();
  return [
    explicitConfig,
    stateDir ? path.join(stateDir, "openclaw.json") : "",
    "/data/openclaw/state-root/openclaw.json",
    path.join(home, ".openclaw", "openclaw.json"),
  ].filter(Boolean);
}

function resolveConfigPath() {
  for (const candidate of getConfigCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("cannot locate openclaw.json");
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

async function waitForAuthenticatedClient(account) {
  const wsClient = new WSClient({
    botId: account.botId,
    secret: account.secret,
    wsUrl: account.websocketUrl || DEFAULT_WS_URL,
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
    wsClient.on("disconnected", (reason) => settle(reject, new Error("WS disconnected before auth: " + reason)));
    wsClient.on("event.disconnected_event", () => settle(reject, new Error("WS disconnected_event received")));

    try {
      wsClient.connect();
    } catch (error) {
      settle(reject, error);
    }
  });
}

function normalizeUnsupported(result, category, stage) {
  const errcode = Number(result?.errcode);
  const rawMessage =
    typeof result?.error === "string"
      ? result.error
      : typeof result?.errmsg === "string"
        ? result.errmsg
        : typeof result?.message === "string"
          ? result.message
          : "";
  return errcode === UNSUPPORTED_BIZ_TYPE_ERRCODE || /unsupported mcp biz type/i.test(rawMessage)
    ? {
        ok: false,
        category,
        stage,
        errcode: UNSUPPORTED_BIZ_TYPE_ERRCODE,
        errmsg: rawMessage || 'unsupported mcp biz type for category "' + category + '"',
      }
    : null;
}

function normalizeProbeError(error, category, stage) {
  const unsupported = normalizeUnsupported(error, category, stage);
  if (unsupported) {
    return unsupported;
  }
  return {
    ok: false,
    category,
    stage,
    errcode: error?.errcode ?? error?.code ?? error?.statusCode ?? -1,
    errmsg: error?.errmsg ?? error?.message ?? String(error),
  };
}

async function fetchMcpConfig(wsClient, category, pluginVersion) {
  const reqId = generateReqId("mcp_probe");
  const response = await withTimeout(
    wsClient.reply(
      { headers: { req_id: reqId } },
      { biz_type: category, plugin_version: pluginVersion || DEFAULT_PLUGIN_VERSION },
      MCP_GET_CONFIG_CMD,
    ),
    MCP_CONFIG_FETCH_TIMEOUT_MS,
    'Timed out fetching MCP config for category "' + category + '"',
  );

  const unsupported = normalizeUnsupported(response, category, "get_mcp_config");
  if (unsupported) {
    return unsupported;
  }

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
      const error = new Error("HTTP " + response.status + " " + response.statusText);
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
      protocolVersion: protocolVersion || DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "wecom_mcp_remote_probe", version: "1.0.0" },
    },
  });
  sessionId = init.sessionId;

  if (sessionId) {
    const initialized = await sendRawJsonRpc(url, sessionId, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    sessionId = initialized.sessionId;
  }

  const listed = await sendRawJsonRpc(url, sessionId, {
    jsonrpc: "2.0",
    id: generateReqId("mcp_list"),
    method: "tools/list",
  });

  return listed.result?.tools ?? [];
}

async function probeCategory(wsClient, args, category) {
  let mcpConfig;
  try {
    mcpConfig = await fetchMcpConfig(wsClient, category, args.pluginVersion);
  } catch (error) {
    return normalizeProbeError(error, category, "get_mcp_config");
  }
  if (!mcpConfig.ok) {
    return mcpConfig;
  }

  try {
    const tools = await listTools(mcpConfig.url, args.protocolVersion);
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
    return normalizeProbeError(error, category, "tools/list");
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const configPath = resolveConfigPath();
  const config = parseConfigFile(configPath);
  const account = resolveMcpAccount(config, args.account);
  if (!account.botId || !account.secret) {
    throw new Error(
      args.account
        ? 'account "' + args.account + '" is missing botId/secret'
        : "default WeCom account is missing botId/secret",
    );
  }

  const wsClient = await waitForAuthenticatedClient(account);
  const results = [];
  try {
    for (const category of args.categories) {
      results.push(await probeCategory(wsClient, args, category));
    }
  } finally {
    try {
      wsClient.disconnect();
    } catch {
      // Ignore disconnect failures on exit.
    }
  }

  console.log(JSON.stringify({
    ok: true,
    config_path: configPath,
    account_id: account.accountId,
    categories: results,
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    stage: "bootstrap",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
`;

function parseArgs(argv) {
  const args = {
    host: DEFAULT_HOST,
    categories: DEFAULT_CATEGORIES,
    account: "",
    pluginVersion: "",
    protocolVersion: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--host" && argv[index + 1]) {
      args.host = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current.startsWith("--host=")) {
      args.host = current.split("=")[1].trim();
      continue;
    }
    if (current === "--categories" && argv[index + 1]) {
      args.categories = argv[index + 1].split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (current.startsWith("--categories=")) {
      args.categories = current.split("=")[1].split(",").map((item) => item.trim()).filter(Boolean);
      continue;
    }
    if (current === "--account" && argv[index + 1]) {
      args.account = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current.startsWith("--account=")) {
      args.account = current.split("=")[1].trim();
      continue;
    }
    if (current === "--pluginVersion" && argv[index + 1]) {
      args.pluginVersion = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current.startsWith("--pluginVersion=")) {
      args.pluginVersion = current.split("=")[1].trim();
      continue;
    }
    if (current === "--protocolVersion" && argv[index + 1]) {
      args.protocolVersion = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current.startsWith("--protocolVersion=")) {
      args.protocolVersion = current.split("=")[1].trim();
      continue;
    }
    if (current === "--json") {
      args.json = true;
    }
  }
  if (!args.categories.length) {
    args.categories = DEFAULT_CATEGORIES;
  }
  return args;
}

function quoteShellArg(value) {
  return "'" + String(value).replace(/'/g, `'\"'\"'`) + "'";
}

function runRemoteProbe(options) {
  const remoteArgs = [
    "--categories=" + options.categories.join(","),
  ];
  if (options.account) {
    remoteArgs.push("--account=" + options.account);
  }
  if (options.pluginVersion) {
    remoteArgs.push("--pluginVersion=" + options.pluginVersion);
  }
  if (options.protocolVersion) {
    remoteArgs.push("--protocolVersion=" + options.protocolVersion);
  }

  const pluginDir = "/root/.openclaw/extensions/wecom";
  const remoteCommand =
    "tmp=" +
    pluginDir +
    "/.cursor-wecom-mcp-remote-probe-$$.mjs" +
    " && cat > \"$tmp\"" +
    " && cd " +
    pluginDir +
    " && node \"$tmp\" " +
    remoteArgs.map((arg) => quoteShellArg(arg)).join(" ") +
    "; rc=$?" +
    " && rm -f \"$tmp\"" +
    " && exit $rc";
  const result = spawnSync("ssh", [options.host, remoteCommand], {
    input: REMOTE_NODE,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      throw new Error("cannot parse ssh stdout as JSON: " + error.message + (stderr ? "\n" + stderr : ""));
    }
  }

  return {
    status: result.status ?? 1,
    stdout,
    stderr,
    parsed,
  };
}

function isUnsupportedCategory(entry) {
  const message = String(entry?.errmsg ?? entry?.error ?? "").toLowerCase();
  return entry?.errcode === 846609 || message.includes("unsupported mcp biz type");
}

function summarize(parsed, host) {
  const categories = Array.isArray(parsed?.categories) ? parsed.categories : [];
  const summary = {
    ok: Boolean(parsed?.ok),
    host,
    account_id: parsed?.account_id ?? "",
    config_path: parsed?.config_path ?? "",
    opened: [],
    not_opened: [],
    tools: {},
    urls: {},
    errors: {},
  };

  for (const entry of categories) {
    const category = entry?.category;
    if (!category) {
      continue;
    }
    if (entry.ok) {
      summary.opened.push(category);
      summary.tools[category] = Array.isArray(entry.tools)
        ? entry.tools.map((tool) => tool?.name).filter(Boolean)
        : [];
      summary.urls[category] = entry.url ?? "";
      continue;
    }
    if (isUnsupportedCategory(entry)) {
      summary.not_opened.push(category);
      summary.errors[category] = {
        stage: entry.stage ?? "tools/list",
        errcode: entry.errcode ?? 846609,
        errmsg: entry.errmsg ?? entry.error ?? "unsupported mcp biz type",
      };
      continue;
    }
    summary.errors[category] = {
      stage: entry.stage ?? "unknown",
      errcode: entry.errcode ?? -1,
      errmsg: entry.errmsg ?? entry.error ?? "unknown error",
    };
  }

  summary.opened.sort();
  summary.not_opened.sort();
  return summary;
}

function printHumanSummary(summary, stderr) {
  console.log("host: " + summary.host);
  console.log("account: " + (summary.account_id || "-"));
  console.log("config: " + (summary.config_path || "-"));
  console.log("opened: " + (summary.opened.join(", ") || "-"));
  console.log("not_opened: " + (summary.not_opened.join(", ") || "-"));
  if (Object.keys(summary.errors).length > 0) {
    console.log("errors:");
    for (const [category, detail] of Object.entries(summary.errors)) {
      console.log(
        "  " +
          category +
          ": stage=" +
          (detail.stage ?? "unknown") +
          " errcode=" +
          String(detail.errcode ?? "-") +
          " errmsg=" +
          (detail.errmsg ?? "unknown"),
      );
    }
  }
  if (stderr) {
    console.log("remote_stderr:");
    console.log(stderr);
  }
}

function printUsage() {
  console.error(
    [
      "Usage:",
      "  node scripts/wecom-mcp-remote-probe.js",
      "  node scripts/wecom-mcp-remote-probe.js --categories=doc,contact,msg",
      "  node scripts/wecom-mcp-remote-probe.js --account=default --json",
      "",
      "Optional:",
      "  --host=" + DEFAULT_HOST,
      "  --account=<wecom account id>",
      "  --categories=doc,contact,todo,meeting,schedule,msg",
      "  --pluginVersion=<override plugin_version>",
      "  --protocolVersion=<override MCP protocol version>",
      "  --json",
    ].join("\n"),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = runRemoteProbe(options);
  if (!result.parsed) {
    throw new Error("ssh returned no JSON output" + (result.stderr ? "\n" + result.stderr : ""));
  }

  if (options.json) {
    console.log(JSON.stringify(result.parsed, null, 2));
  } else {
    printHumanSummary(summarize(result.parsed, options.host), result.parsed.stderr || result.stderr);
  }
  process.exit(result.status);
}

try {
  main();
} catch (error) {
  printUsage();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
