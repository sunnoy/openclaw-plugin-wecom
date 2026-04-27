import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));

describe("openclaw plugin manifest", () => {
  it("declares channel config metadata for cold-path OpenClaw validation", () => {
    assert.equal(manifest.kind, "channel");
    assert.deepEqual(manifest.channels, ["wecom"]);
    assert.equal(manifest.channelConfigs?.wecom?.schema?.type, "object");
    assert.equal(manifest.channelConfigs.wecom.schema.additionalProperties, true);
  });
});
