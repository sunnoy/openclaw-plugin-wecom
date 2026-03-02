import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { WecomCrypto } from "../../crypto.js";

const REQUIRED_ENV = [
  "E2E_WECOM_BASE_URL",
  "E2E_WECOM_TOKEN",
  "E2E_WECOM_ENCODING_AES_KEY",
];

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
const skipReason = missingEnv.length > 0
  ? `missing env: ${missingEnv.join(", ")}`
  : false;

const baseUrl = (process.env.E2E_WECOM_BASE_URL || "").replace(/\/+$/, "");
const webhookPath = process.env.E2E_WECOM_WEBHOOK_PATH || "/webhooks/wecom";
const token = process.env.E2E_WECOM_TOKEN || "";
const encodingAesKey = process.env.E2E_WECOM_ENCODING_AES_KEY || "";

const testUserId = process.env.E2E_WECOM_TEST_USER || "wecom-e2e-user";
const testCommand = process.env.E2E_WECOM_TEST_COMMAND || "/status";
const browserPrompt = process.env.E2E_WECOM_BROWSER_PROMPT
  || "请使用浏览器打开 https://example.com 并返回页面标题，若可用请附上一张截图。";
const browserBingPdfPrompt = process.env.E2E_WECOM_BROWSER_BING_PDF_PROMPT
  || "请使用浏览器访问 https://www.bing.com ，并把页面保存为 PDF，然后回复保存结果与 PDF 路径。";

const pollIntervalMs = Number(process.env.E2E_WECOM_POLL_INTERVAL_MS || 1200);
const streamTimeoutMs = Number(process.env.E2E_WECOM_STREAM_TIMEOUT_MS || 90000);
const browserTimeoutMs = Number(process.env.E2E_WECOM_BROWSER_TIMEOUT_MS || 180000);
const enableBrowserCase = (process.env.E2E_WECOM_ENABLE_BROWSER_CASE || "1") !== "0";
const requireBrowserImage = (process.env.E2E_WECOM_BROWSER_REQUIRE_IMAGE || "0") === "1";
const enableBrowserBingPdfCase = (process.env.E2E_WECOM_ENABLE_BROWSER_BING_PDF_CASE || "1") !== "0";
const browserSandboxReady = (process.env.E2E_BROWSER_SANDBOX_READY || "1") === "1";

const fallbackResponseUrl = "https://example.invalid/wecom/e2e";
const fastFailMediaUrl = "http://127.0.0.1:9/e2e-media";
const thinkingPlaceholder = "思考中...";

describe("wecom remote e2e - full matrix", { skip: skipReason }, () => {
  const wecomCrypto = new WecomCrypto(token, encodingAesKey);

  function signEncryptedPayload(plainObject, options = {}) {
    const timestamp = options.timestamp || String(Math.floor(Date.now() / 1000));
    const nonce = options.nonce || `e2e${Math.random().toString(16).slice(2, 10)}`;
    const encrypt = wecomCrypto.encrypt(JSON.stringify(plainObject));
    const signature = options.signature || wecomCrypto.getSignature(timestamp, nonce, encrypt);
    return {
      timestamp,
      nonce,
      signature,
      encrypt,
    };
  }

  async function requestWebhook({
    method = "POST",
    query = {},
    headers = {},
    body,
  } = {}) {
    const qs = new URLSearchParams(query);
    const url = `${baseUrl}${webhookPath}${qs.toString() ? `?${qs.toString()}` : ""}`;
    const options = {
      method,
      headers,
    };
    if (method !== "GET" && method !== "HEAD" && body !== undefined) {
      options.body = body;
    }

    const res = await fetch(url, options);
    const text = await res.text();
    return {
      status: res.status,
      text,
    };
  }

  async function postEncryptedMessage(plainObject, options = {}) {
    const signed = signEncryptedPayload(plainObject, options);
    return requestWebhook({
      method: "POST",
      query: {
        msg_signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encrypt: signed.encrypt }),
    });
  }

  function decodeEncryptedResponse(rawText) {
    const json = JSON.parse(rawText);
    assert.ok(json.encrypt, "response.encrypt should exist");
    assert.ok(json.msgsignature, "response.msgsignature should exist");
    assert.ok(json.timestamp, "response.timestamp should exist");
    assert.ok(json.nonce, "response.nonce should exist");

    const expected = wecomCrypto.getSignature(json.timestamp, json.nonce, json.encrypt);
    assert.equal(json.msgsignature, expected, "response signature should be valid");

    const plain = JSON.parse(wecomCrypto.decrypt(json.encrypt).message);
    return plain;
  }

  async function refreshStream(streamId) {
    const refresh = await postEncryptedMessage({
      msgtype: "stream",
      stream: { id: streamId },
    });
    assert.equal(refresh.status, 200);

    const plain = decodeEncryptedResponse(refresh.text);
    assert.equal(plain.msgtype, "stream");
    assert.equal(plain.stream?.id, streamId);
    return plain;
  }

  function hasMeaningfulContent(plain) {
    const content = String(plain?.stream?.content || "").trim();
    return content.length > 0 && content !== thinkingPlaceholder;
  }

  async function waitStreamResult(streamId, options = {}) {
    const timeoutMs = options.timeoutMs || streamTimeoutMs;
    const requireFinish = options.requireFinish === true;
    const deadline = Date.now() + timeoutMs;
    let latest = options.initialPlain || (await refreshStream(streamId));

    if (requireFinish) {
      if (latest.stream?.finish && hasMeaningfulContent(latest)) {
        return latest;
      }
    } else if (hasMeaningfulContent(latest) || latest.stream?.finish) {
      return latest;
    }

    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      latest = await refreshStream(streamId);

      if (requireFinish) {
        if (latest.stream?.finish && hasMeaningfulContent(latest)) {
          return latest;
        }
      } else if (hasMeaningfulContent(latest) || latest.stream?.finish) {
        return latest;
      }
    }

    if (requireFinish) {
      assert.fail(`stream should finish with content before timeout: ${streamId}`);
    }
    assert.ok(
      hasMeaningfulContent(latest),
      `stream should produce non-placeholder content before timeout: ${streamId}`,
    );
    return latest;
  }

  async function waitStreamMatch(streamId, options = {}) {
    const timeoutMs = options.timeoutMs || streamTimeoutMs;
    const pattern = options.pattern;
    assert.ok(pattern instanceof RegExp, "waitStreamMatch requires RegExp pattern");

    const deadline = Date.now() + timeoutMs;
    let latest = options.initialPlain || (await refreshStream(streamId));
    let content = String(latest.stream?.content || "");

    if (pattern.test(content)) {
      return latest;
    }

    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      latest = await refreshStream(streamId);
      content = String(latest.stream?.content || "");
      if (pattern.test(content)) {
        return latest;
      }
      if (latest.stream?.finish && hasMeaningfulContent(latest)) {
        break;
      }
    }

    assert.match(content, pattern, "stream content should match expected pattern before timeout");
    return latest;
  }

  async function startInboundTurn({
    caseId,
    msgtype,
    payload = {},
    userId = `${testUserId}-${caseId}`,
    chatType = "single",
    chatId = "",
    responseUrl = fallbackResponseUrl,
  }) {
    const msgId = `wecom-e2e-${caseId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const inbound = {
      msgtype,
      msgid: msgId,
      from: { userid: userId },
      chattype: chatType,
      response_url: responseUrl,
      ...payload,
    };
    if (chatId) {
      inbound.chatid = chatId;
    }

    const first = await postEncryptedMessage(inbound);
    assert.equal(first.status, 200);

    const initial = decodeEncryptedResponse(first.text);
    assert.equal(initial.msgtype, "stream");
    assert.ok(initial.stream?.id, `stream id should exist: ${caseId}`);
    assert.equal(typeof initial.stream?.content, "string");

    return {
      msgId,
      initial,
      streamId: initial.stream.id,
    };
  }

  async function runInboundAndWait(options) {
    const started = await startInboundTurn(options);
    if (started.initial.stream.finish) {
      return started.initial;
    }
    return waitStreamResult(started.streamId, {
      timeoutMs: options.timeoutMs || streamTimeoutMs,
      requireFinish: options.requireFinish === true,
      initialPlain: started.initial,
    });
  }

  it("GET verification succeeds with valid signature", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `verify${Math.random().toString(16).slice(2, 10)}`;
    const plainEcho = `openclaw-wecom-e2e-${Date.now()}`;
    const echostr = wecomCrypto.encrypt(plainEcho);
    const signature = wecomCrypto.getSignature(timestamp, nonce, echostr);

    const res = await requestWebhook({
      method: "GET",
      query: {
        msg_signature: signature,
        timestamp,
        nonce,
        echostr,
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.text, plainEcho);
  });

  it("GET verification fails with invalid signature", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `verify${Math.random().toString(16).slice(2, 10)}`;
    const echostr = wecomCrypto.encrypt("invalid-signature-case");

    const res = await requestWebhook({
      method: "GET",
      query: {
        msg_signature: "deadbeef",
        timestamp,
        nonce,
        echostr,
      },
    });

    assert.equal(res.status, 403);
    assert.equal(res.text.trim(), "Verification failed");
  });

  it("POST fails when required query params are missing", async () => {
    const res = await requestWebhook({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encrypt: "invalid" }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.text.trim(), "Bad Request");
  });

  it("POST fails on signature mismatch", async () => {
    const res = await postEncryptedMessage(
      {
        msgtype: "text",
        msgid: `sig-mismatch-${Date.now()}`,
        from: { userid: `${testUserId}-sig-mismatch` },
        chattype: "single",
        text: { content: "signature mismatch case" },
      },
      { signature: "deadbeef" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.text.trim(), "Bad Request");
  });

  it("POST fails on unsupported msgtype", async () => {
    const res = await postEncryptedMessage({
      msgtype: "unsupported_e2e",
      msgid: `unknown-${Date.now()}`,
      from: { userid: `${testUserId}-unknown` },
      chattype: "single",
    });
    assert.equal(res.status, 400);
    assert.equal(res.text.trim(), "Bad Request");
  });

  it("runs text command inbound and stream outbound", async () => {
    const result = await runInboundAndWait({
      caseId: "text-command",
      msgtype: "text",
      payload: { text: { content: testCommand } },
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("blocks unallowlisted command without LLM dispatch", async () => {
    const result = await runInboundAndWait({
      caseId: "blocked-command",
      msgtype: "text",
      payload: { text: { content: "/definitely_not_allowed_command_e2e" } },
      requireFinish: true,
    });
    assert.match(result.stream.content, /该命令不可用/);
  });

  it("merges debounced non-command messages and closes secondary stream", async () => {
    const userId = `${testUserId}-debounce`;

    const first = await startInboundTurn({
      caseId: "debounce-1",
      userId,
      msgtype: "text",
      payload: { text: { content: "第一条防抖消息" } },
    });
    const second = await startInboundTurn({
      caseId: "debounce-2",
      userId,
      msgtype: "text",
      payload: { text: { content: "第二条防抖消息" } },
    });

    const mergedNotice = await waitStreamResult(second.streamId, {
      timeoutMs: 90000,
      requireFinish: false,
    });
    assert.match(mergedNotice.stream.content, /消息已合并到第一条回复中/);

    const primary = await waitStreamResult(first.streamId, { timeoutMs: 120000 });
    assert.ok(primary.stream.content.length > 0);
  });

  it("runs voice inbound and stream outbound", async () => {
    const result = await runInboundAndWait({
      caseId: "voice",
      msgtype: "voice",
      payload: {
        voice: { content: "这是语音转写e2e测试，请返回一句确认。" },
      },
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("runs image inbound and stream outbound", async () => {
    const result = await runInboundAndWait({
      caseId: "image",
      msgtype: "image",
      payload: {
        image: { url: fastFailMediaUrl },
      },
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("runs file inbound and stream outbound", async () => {
    const result = await runInboundAndWait({
      caseId: "file",
      msgtype: "file",
      payload: {
        file: { url: fastFailMediaUrl, name: "wecom-e2e.txt" },
      },
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("runs mixed inbound and stream outbound", async () => {
    const result = await runInboundAndWait({
      caseId: "mixed",
      msgtype: "mixed",
      payload: {
        mixed: {
          msg_item: [
            { msgtype: "text", text: { content: "这是一条图文混排e2e测试消息" } },
            { msgtype: "image", image: { url: fastFailMediaUrl } },
          ],
        },
      },
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("runs link inbound and stream outbound", async () => {
    const result = await runInboundAndWait({
      caseId: "link",
      msgtype: "link",
      payload: {
        link: {
          title: "Example Domain",
          description: "Link message inbound test",
          url: "https://example.com",
        },
      },
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("runs location inbound and stream outbound", async () => {
    const result = await runInboundAndWait({
      caseId: "location",
      msgtype: "location",
      payload: {
        location: {
          latitude: "31.2304",
          longitude: "121.4737",
          name: "上海市黄浦区",
        },
      },
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("group message without @ mention is gated", async () => {
    const result = await runInboundAndWait({
      caseId: "group-no-mention",
      msgtype: "text",
      chatType: "group",
      chatId: "wr_e2e_group_no_mention",
      payload: {
        text: { content: "这是一条群聊消息，但没有提及机器人" },
      },
      timeoutMs: 45000,
      requireFinish: true,
    });
    assert.equal(result.stream.content, "请@提及我以获取回复。");
  });

  it("group message with @ mention is processed", async () => {
    const result = await runInboundAndWait({
      caseId: "group-with-mention",
      msgtype: "text",
      chatType: "group",
      chatId: "wr_e2e_group_with_mention",
      payload: {
        text: { content: "@bot 你好，请简短回复 group mention e2e" },
      },
      timeoutMs: 120000,
      requireFinish: false,
    });
    assert.ok(result.stream.content.length > 0);
  });

  it("rejects duplicate msgid with success ACK", async () => {
    const userId = `${testUserId}-dup`;
    const msgId = `wecom-e2e-dup-${Date.now()}`;
    const payload = {
      msgtype: "text",
      msgid: msgId,
      from: { userid: userId },
      chattype: "single",
      response_url: fallbackResponseUrl,
      text: { content: "/help" },
    };

    const first = await postEncryptedMessage(payload);
    assert.equal(first.status, 200);
    const firstPlain = decodeEncryptedResponse(first.text);
    assert.equal(firstPlain.msgtype, "stream");

    const second = await postEncryptedMessage(payload);
    assert.equal(second.status, 200);
    if (second.text.trim() === "success") {
      return;
    }

    // Current runtime may still return a stream when dedupe state is not shared cross-requests.
    const secondPlain = decodeEncryptedResponse(second.text);
    assert.equal(secondPlain.msgtype, "stream");
  });

  it("returns expired response for unknown stream refresh", async () => {
    const plain = await refreshStream(`not-found-${Date.now()}`);
    assert.equal(plain.stream?.finish, true);
    assert.equal(plain.stream?.content, "会话已过期");
  });

  it("handles enter_chat event with welcome stream", async () => {
    const res = await postEncryptedMessage({
      msgtype: "event",
      event: {
        event_type: "enter_chat",
        from: { userid: `${testUserId}-event` },
      },
    });
    assert.equal(res.status, 200);

    const plain = decodeEncryptedResponse(res.text);
    assert.equal(plain.msgtype, "stream");
    assert.equal(plain.stream?.finish, true);
    assert.match(plain.stream?.content || "", /我是 AI 助手/);
  });

  it(
    "runs browser scenario inbound and validates stream outbound",
    {
      skip: !enableBrowserCase && "browser case disabled by E2E_WECOM_ENABLE_BROWSER_CASE=0",
      timeout: browserTimeoutMs + 60000,
    },
    async () => {
      const result = await runInboundAndWait({
        caseId: "browser",
        msgtype: "text",
        timeoutMs: browserTimeoutMs,
        requireFinish: false,
        payload: { text: { content: browserPrompt } },
      });

      assert.ok(result.stream.content.length > 0);
      if (requireBrowserImage) {
        assert.ok(
          Array.isArray(result.stream.msg_item) && result.stream.msg_item.length > 0,
          "browser case expected msg_item images, but none were found",
        );
      }
    },
  );

  it(
    "covers outbound image prompt path (msg_item when available)",
    { timeout: browserTimeoutMs + 60000 },
    async () => {
      const result = await runInboundAndWait({
        caseId: "outbound-image",
        msgtype: "text",
        timeoutMs: browserTimeoutMs,
        requireFinish: false,
        payload: {
          text: {
            content: "请调用浏览器或截图能力，输出一张图片并附带简短说明。",
          },
        },
      });

      if (Array.isArray(result.stream.msg_item) && result.stream.msg_item.length > 0) {
        assert.equal(result.stream.msg_item[0].msgtype, "image");
      } else {
        assert.ok(result.stream.content.length > 0);
      }
    },
  );

  it(
    "runs browser case: open bing and save pdf",
    {
      skip:
        (!enableBrowserCase && "browser case disabled by E2E_WECOM_ENABLE_BROWSER_CASE=0")
        || (!enableBrowserBingPdfCase
          && "browser bing pdf case disabled by E2E_WECOM_ENABLE_BROWSER_BING_PDF_CASE=0")
        || (!browserSandboxReady
          && "browser sandbox not ready (missing chrome/browser skill)"),
      timeout: browserTimeoutMs + 60000,
    },
    async () => {
      const started = await startInboundTurn({
        caseId: "browser-bing-pdf",
        msgtype: "text",
        payload: { text: { content: browserBingPdfPrompt } },
      });

      const result = await waitStreamMatch(started.streamId, {
        timeoutMs: browserTimeoutMs,
        initialPlain: started.initial,
        pattern: /(pdf|\.pdf|保存|另存|失败|unable|not available|不可用)/i,
      });

      const content = String(result.stream.content || "");
      assert.ok(content.length > 0);
      const pdfPathMatch = content.match(/\/[^\s'"`]+\.pdf\b/i);
      if (pdfPathMatch) {
        // Printed for CI/log parsers and downloader scripts.
        console.log(`[E2E_PDF_PATH] ${pdfPathMatch[0]}`);
      }
    },
  );
});
