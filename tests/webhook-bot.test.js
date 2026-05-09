import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { webhookBotTesting, webhookSendMarkdown } from "../wecom/webhook-bot.js";

const { buildWebhookMarkdownBody, hasRemoteMarkdownImage } = webhookBotTesting;

describe("webhook markdown delivery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses markdown for regular webhook markdown content", () => {
    assert.deepEqual(buildWebhookMarkdownBody("## 标题\n- 第一项"), {
      msgtype: "markdown",
      markdown: { content: "## 标题\n- 第一项" },
    });
  });

  it("uses markdown_v2 for webhook markdown content with remote images", () => {
    const content = "步骤如下\n\n![图1](https://example.com/a.png)";
    assert.equal(hasRemoteMarkdownImage(content), true);
    assert.deepEqual(buildWebhookMarkdownBody(content), {
      msgtype: "markdown_v2",
      markdown_v2: { content },
    });
  });

  it("falls back to markdown when webhook markdown_v2 is rejected", async () => {
    const calls = [];
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return {
        async json() {
          return body.msgtype === "markdown_v2"
            ? { errcode: 40008, errmsg: "invalid msgtype" }
            : { errcode: 0, errmsg: "ok" };
        },
      };
    };

    const content = "说明\n\n![图1](https://example.com/a.png)";
    await webhookSendMarkdown({ url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test", content });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].msgtype, "markdown_v2");
    assert.deepEqual(calls[1], {
      msgtype: "markdown",
      markdown: { content },
    });
  });
});
