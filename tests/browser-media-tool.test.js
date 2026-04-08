import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { browserMediaToolTesting } from "../wecom/browser-media-tool.js";

const { executeStageBrowserMedia } = browserMediaToolTesting;

function resultText(result) {
  return result?.content?.[0]?.text ?? "";
}

describe("stage_browser_media tool", () => {
  it("copies browser images into the current workspace and returns a MEDIA directive", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wecom-browser-media-"));

    try {
      const stateDir = tempDir;
      const workspaceDir = path.join(tempDir, "workspace-test-agent");
      const browserMediaDir = path.join(stateDir, "media", "browser");
      const sourcePath = path.join(browserMediaDir, "snapshot.png");
      await mkdir(browserMediaDir, { recursive: true });
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(sourcePath, Buffer.from("png-bytes"));

      const result = await executeStageBrowserMedia(
        { source: `MEDIA:${sourcePath}` },
        { stateDir, workspaceDir },
      );

      assert.equal(result?.details?.directive, "MEDIA:/workspace/.openclaw/browser-media/snapshot.png");
      assert.match(resultText(result), /MEDIA:\/workspace\/.openclaw\/browser-media\/snapshot\.png/);
      assert.equal(
        (await readFile(path.join(workspaceDir, ".openclaw", "browser-media", "snapshot.png"))).toString("utf8"),
        "png-bytes",
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns FILE directives for non-image browser files and supports target_name", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wecom-browser-media-"));

    try {
      const stateDir = tempDir;
      const workspaceDir = path.join(tempDir, "workspace-test-agent");
      const browserMediaDir = path.join(stateDir, "media", "browser");
      const sourcePath = path.join(browserMediaDir, "report.pdf");
      await mkdir(browserMediaDir, { recursive: true });
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(sourcePath, Buffer.from("pdf-bytes"));

      const result = await executeStageBrowserMedia(
        { source: sourcePath, target_name: "renamed-report" },
        { stateDir, workspaceDir },
      );

      assert.equal(result?.details?.directive, "FILE:/workspace/.openclaw/browser-media/renamed-report.pdf");
      assert.equal(
        (await readFile(path.join(workspaceDir, ".openclaw", "browser-media", "renamed-report.pdf"))).toString("utf8"),
        "pdf-bytes",
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes outside the browser media root", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wecom-browser-media-"));

    try {
      const stateDir = tempDir;
      const workspaceDir = path.join(tempDir, "workspace-test-agent");
      const browserMediaDir = path.join(stateDir, "media", "browser");
      const outsidePath = path.join(tempDir, "secret.txt");
      const sourcePath = path.join(browserMediaDir, "secret-link.txt");
      await mkdir(browserMediaDir, { recursive: true });
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(outsidePath, Buffer.from("secret"));
      await symlink(outsidePath, sourcePath);

      const result = await executeStageBrowserMedia(
        { source: sourcePath },
        { stateDir, workspaceDir },
      );

      assert.match(result?.details?.error ?? "", /outside the allowed root/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
