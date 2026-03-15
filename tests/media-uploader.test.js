import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectWeComMediaType,
  applyFileSizeLimits,
  extractFileName,
  mimeToExtension,
  buildMediaErrorSummary,
} from "../wecom/media-uploader.js";

describe("detectWeComMediaType", () => {
  it("detects image types", () => {
    assert.equal(detectWeComMediaType("image/jpeg"), "image");
    assert.equal(detectWeComMediaType("image/png"), "image");
    assert.equal(detectWeComMediaType("image/gif"), "image");
    assert.equal(detectWeComMediaType("image/webp"), "image");
    assert.equal(detectWeComMediaType("IMAGE/PNG"), "image");
  });

  it("detects video types", () => {
    assert.equal(detectWeComMediaType("video/mp4"), "video");
    assert.equal(detectWeComMediaType("video/quicktime"), "video");
    assert.equal(detectWeComMediaType("video/webm"), "video");
  });

  it("detects voice types", () => {
    assert.equal(detectWeComMediaType("audio/amr"), "voice");
    assert.equal(detectWeComMediaType("audio/mpeg"), "voice");
    assert.equal(detectWeComMediaType("audio/wav"), "voice");
    assert.equal(detectWeComMediaType("application/ogg"), "voice");
  });

  it("defaults to file for unknown types", () => {
    assert.equal(detectWeComMediaType("application/pdf"), "file");
    assert.equal(detectWeComMediaType("application/zip"), "file");
    assert.equal(detectWeComMediaType("text/plain"), "file");
    assert.equal(detectWeComMediaType(""), "file");
    assert.equal(detectWeComMediaType(null), "file");
    assert.equal(detectWeComMediaType(undefined), "file");
  });
});

describe("applyFileSizeLimits", () => {
  const MB = 1024 * 1024;

  it("passes small images", () => {
    const result = applyFileSizeLimits(5 * MB, "image", "image/jpeg");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, false);
    assert.equal(result.finalType, "image");
  });

  it("downgrades large images to file", () => {
    const result = applyFileSizeLimits(11 * MB, "image", "image/png");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, true);
    assert.equal(result.finalType, "file");
    assert.ok(result.downgradeNote.includes("10MB"));
  });

  it("downgrades large videos to file", () => {
    const result = applyFileSizeLimits(11 * MB, "video", "video/mp4");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, true);
    assert.equal(result.finalType, "file");
  });

  it("downgrades non-AMR voice to file", () => {
    const result = applyFileSizeLimits(1 * MB, "voice", "audio/mpeg");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, true);
    assert.equal(result.finalType, "file");
    assert.ok(result.downgradeNote.includes("AMR"));
  });

  it("passes small AMR voice", () => {
    const result = applyFileSizeLimits(1 * MB, "voice", "audio/amr");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, false);
    assert.equal(result.finalType, "voice");
  });

  it("downgrades large AMR voice to file", () => {
    const result = applyFileSizeLimits(3 * MB, "voice", "audio/amr");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, true);
    assert.equal(result.finalType, "file");
    assert.ok(result.downgradeNote.includes("2MB"));
  });

  it("rejects files over 20MB", () => {
    const result = applyFileSizeLimits(21 * MB, "file", "application/pdf");
    assert.equal(result.shouldReject, true);
    assert.ok(result.rejectReason.includes("20MB"));
  });

  it("passes files under 20MB", () => {
    const result = applyFileSizeLimits(15 * MB, "file", "application/pdf");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, false);
    assert.equal(result.finalType, "file");
  });

  it("boundary: image exactly at 10MB passes", () => {
    const result = applyFileSizeLimits(10 * MB, "image", "image/png");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, false);
  });

  it("boundary: file exactly at 20MB passes", () => {
    const result = applyFileSizeLimits(20 * MB, "file", "application/zip");
    assert.equal(result.shouldReject, false);
    assert.equal(result.downgraded, false);
  });
});

describe("extractFileName", () => {
  it("uses provided fileName", () => {
    assert.equal(extractFileName("/path/to/file.pdf", "custom.pdf", ""), "custom.pdf");
  });

  it("extracts from URL path", () => {
    assert.equal(extractFileName("/workspace/output.xlsx", undefined, ""), "output.xlsx");
  });

  it("extracts from HTTP URL", () => {
    assert.equal(
      extractFileName("https://example.com/files/report.pdf", undefined, ""),
      "report.pdf",
    );
  });

  it("generates fallback from MIME type", () => {
    const name = extractFileName("/path/no-ext", undefined, "image/png");
    assert.ok(name.endsWith(".png"));
    assert.ok(name.startsWith("media_"));
  });
});

describe("mimeToExtension", () => {
  it("maps known MIME types", () => {
    assert.equal(mimeToExtension("image/jpeg"), ".jpg");
    assert.equal(mimeToExtension("application/pdf"), ".pdf");
    assert.equal(mimeToExtension("audio/amr"), ".amr");
  });

  it("returns .bin for unknown types", () => {
    assert.equal(mimeToExtension("application/x-custom"), ".bin");
  });
});

describe("buildMediaErrorSummary", () => {
  it("handles LocalMediaAccessError", () => {
    const summary = buildMediaErrorSummary("/path/file.pdf", {
      error: "LocalMediaAccessError: not allowed",
    });
    assert.ok(summary.includes("没有权限"));
    assert.ok(summary.includes("mediaLocalRoots"));
  });

  it("uses rejectReason when available", () => {
    const summary = buildMediaErrorSummary("/path/file.pdf", {
      rejectReason: "文件太大",
    });
    assert.ok(summary.includes("文件太大"));
  });

  it("falls back to generic message", () => {
    const summary = buildMediaErrorSummary("/path/file.pdf", {});
    assert.ok(summary.includes("无法处理文件"));
  });
});
