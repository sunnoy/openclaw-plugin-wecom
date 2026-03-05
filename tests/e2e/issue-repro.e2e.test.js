/**
 * Issue Reproduction E2E Tests
 * Targeting: #68 (Agent mode path), #66 (requireMention), #70 (workspace)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WecomCrypto } from "../../crypto.js";

const REQUIRED_ENV = [
  "E2E_WECOM_BASE_URL",
  "E2E_WECOM_TOKEN",
  "E2E_WECOM_ENCODING_AES_KEY",
];

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
const skipReason = missingEnv.length > 0 ? `missing env: ${missingEnv.join(", ")}` : false;

const baseUrl = (process.env.E2E_WECOM_BASE_URL || "").replace(/\/+$/, "");
const token = process.env.E2E_WECOM_TOKEN || "";
const aesKey = process.env.E2E_WECOM_ENCODING_AES_KEY || "";
const crypto = skipReason ? null : new WecomCrypto(token, aesKey);

describe("Issue Reproduction Matrix", { skip: skipReason }, () => {

  // ── #68: Protocol Mismatch Test ─────────────────────────────────────
  // What happens if we send XML (Agent protocol) to a Bot path?
  it("#68: Sending XML to Bot-mode path should not crash and return 400", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "repro68";
    const xmlBody = [
      "<xml>",
      "<ToUserName><![CDATA[corp_id]]></ToUserName>",
      `<Encrypt><![CDATA[${crypto.encrypt("<xml>inner</xml>")}]]></Encrypt>`,
      "</xml>",
    ].join("\n");

    const msgSignature = crypto.getSignature(timestamp, nonce, crypto.encrypt("<xml>inner</xml>"));
    
    // Requesting the BOT path with XML body
    const url = `${baseUrl}/webhooks/wecom?msg_signature=${msgSignature}&timestamp=${timestamp}&nonce=${nonce}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xmlBody,
    });

    // If it tries to parse XML as JSON, it might return 400 (Bad Request)
    // The issue reported a crash/error in logs.
    assert.ok(res.status >= 400, `Expected error status, got ${res.status}`);
    const text = await res.text();
    console.log(`[#68 Repro] Status: ${res.status}, Body: ${text.substring(0, 100)}`);
  });

  // ── #66: Group Message requireMention Test ──────────────────────────
  it("#66: Group message without @ mention behavior check", async () => {
    const inbound = {
      msgtype: "text",
      msgid: `repro66-${Date.now()}`,
      from: { userid: "e2e-repro-user" },
      chattype: "group",
      chatid: "wr_repro_group_66",
      response_url: "http://invalid.url",
      text: { content: "这条消息没有提及机器人" },
    };

    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "repro66";
    const encrypt = crypto.encrypt(JSON.stringify(inbound));
    const signature = crypto.getSignature(timestamp, nonce, encrypt);

    const url = `${baseUrl}/webhooks/wecom?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encrypt }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    const plain = JSON.parse(crypto.decrypt(json.encrypt).message);
    
    console.log(`[#66 Repro] Content: "${plain.stream?.content}"`);
    // If it says "请@提及我", then requireMention is true.
    // If it returns "思考中..." or AI reply, then requireMention is false.
  });

  // ── #68: Multi-Account Sub-path Routing ─────────────────────────────
  it("#68: Sub-path routing check (bot vs app accounts)", async () => {
    const checkPath = async (p) => {
      const url = `${baseUrl}${p}`;
      const res = await fetch(url, { method: "GET" });
      return res.status;
    };

    const statusDefault = await checkPath("/webhooks/wecom");
    console.log(`[/webhooks/wecom] Status: ${statusDefault}`);

    // Agent-only account should NOT have a /webhooks/wecom path (FIXED #68)
    const statusSara = await checkPath("/webhooks/wecom/sara");
    console.log(`[/webhooks/wecom/sara] Status: ${statusSara} (Expected 404)`);
    assert.equal(statusSara, 404, "Agent-only account should not hijack bot routes");

    // Agent path should be active
    const statusApp = await checkPath("/webhooks/app");
    assert.ok(statusApp === 200 || statusApp === 401 || statusApp === 403, "Agent base path should be reachable");
  });
});
