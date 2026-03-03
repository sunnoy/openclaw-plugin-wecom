import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentMediaTypeFromFilename } from "../wecom/channel-plugin.js";

describe("resolveAgentMediaTypeFromFilename", () => {
  it("returns image for supported image extensions", () => {
    assert.equal(resolveAgentMediaTypeFromFilename("photo.jpg"), "image");
    assert.equal(resolveAgentMediaTypeFromFilename("photo.PNG"), "image");
    assert.equal(resolveAgentMediaTypeFromFilename("photo.gif"), "image");
  });

  it("returns file for non-image extensions", () => {
    assert.equal(resolveAgentMediaTypeFromFilename("report.pdf"), "file");
    assert.equal(resolveAgentMediaTypeFromFilename("archive.zip"), "file");
  });

  it("returns file when filename has no extension", () => {
    assert.equal(resolveAgentMediaTypeFromFilename("README"), "file");
  });
});
