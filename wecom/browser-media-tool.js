import path, { basename, extname, join, parse, relative, resolve } from "node:path";
import { access, copyFile, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]);

function textResult(text, details) {
  return {
    content: [{ type: "text", text }],
    ...(details !== undefined ? { details } : {}),
  };
}

function errorResult(message, extra = {}) {
  return textResult(JSON.stringify({ error: message, ...extra }, null, 2), {
    error: message,
    ...extra,
  });
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveStateDir(stateDir) {
  const fromContext = normalizeString(stateDir);
  if (fromContext) {
    return resolve(fromContext);
  }

  const override = normalizeString(process.env.OPENCLAW_STATE_DIR);
  if (override) {
    return resolve(override.startsWith("~") ? join(process.env.HOME || os.homedir(), override.slice(1)) : override);
  }

  return join(process.env.HOME || os.homedir(), ".openclaw");
}

function stripDirectivePrefix(value) {
  let normalized = normalizeString(value).replace(/^\s*(?:MEDIA|FILE)\s*:\s*/i, "");
  if (/^file:\/\//i.test(normalized)) {
    normalized = fileURLToPath(normalized);
  }
  return normalized;
}

async function resolveSourcePath(rawSource) {
  const normalized = stripDirectivePrefix(rawSource);
  if (!normalized) {
    throw new Error("source is required");
  }
  const absolute = resolve(normalized);
  return await realpath(absolute);
}

function assertPathInsideRoot(filePath, rootPath, label) {
  const normalizedRoot = resolve(rootPath);
  const normalizedPath = resolve(filePath);
  if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return;
  }
  throw new Error(`${label} is outside the allowed root: ${filePath}`);
}

function sanitizeTargetName(targetName, sourcePath) {
  const requested = basename(normalizeString(targetName));
  if (!requested || requested === "." || requested === "..") {
    return basename(sourcePath);
  }
  if (extname(requested)) {
    return requested;
  }
  return `${requested}${extname(sourcePath)}`;
}

async function allocateDestinationPath(destDir, fileName) {
  const parsed = parse(fileName);
  let attempt = 0;

  while (true) {
    const candidateName = attempt === 0 ? fileName : `${parsed.name}-${attempt}${parsed.ext}`;
    const candidatePath = join(destDir, candidateName);
    try {
      await access(candidatePath);
      attempt += 1;
    } catch {
      return candidatePath;
    }
  }
}

function inferDirectivePrefix(sourcePath, replyAs) {
  const normalized = normalizeString(replyAs).toLowerCase();
  if (normalized === "media") {
    return "MEDIA";
  }
  if (normalized === "file") {
    return "FILE";
  }
  return IMAGE_EXTENSIONS.has(extname(sourcePath).toLowerCase()) ? "MEDIA" : "FILE";
}

function toWorkspaceDirectivePath(workspaceDir, destinationPath) {
  const relativePath = relative(resolve(workspaceDir), resolve(destinationPath));
  if (!relativePath || relativePath.startsWith("..")) {
    throw new Error(`staged file escaped workspace: ${destinationPath}`);
  }
  return `/workspace/${relativePath.split(/\\+/).join("/")}`;
}

async function executeStageBrowserMedia(input, ctx) {
  try {
    const workspaceDir = normalizeString(ctx?.workspaceDir);
    if (!workspaceDir) {
      throw new Error("Current tool context does not include workspaceDir.");
    }

    const browserMediaDir = join(resolveStateDir(ctx?.stateDir), "media", "browser");
    const browserMediaRoot = await realpath(browserMediaDir);
    const sourcePath = await resolveSourcePath(input?.source);
    assertPathInsideRoot(sourcePath, browserMediaRoot, "Browser media source");

    const destDir = join(resolve(workspaceDir), ".openclaw", "browser-media");
    await mkdir(destDir, { recursive: true });

    const targetName = sanitizeTargetName(input?.target_name, sourcePath);
    const destinationPath = await allocateDestinationPath(destDir, targetName);
    assertPathInsideRoot(destinationPath, workspaceDir, "Workspace destination");
    await copyFile(sourcePath, destinationPath);

    const workspacePath = toWorkspaceDirectivePath(workspaceDir, destinationPath);
    const directivePrefix = inferDirectivePrefix(sourcePath, input?.reply_as);
    const directive = `${directivePrefix}:${workspacePath}`;

    return textResult(
      [
        "Staged browser media into the current workspace.",
        directive,
      ].join("\n"),
      {
        sourcePath,
        destinationPath,
        workspacePath,
        directive,
      },
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export function createStageBrowserMediaTool() {
  return (ctx) => ({
    name: "stage_browser_media",
    label: "Stage Browser Media",
    description: [
      "Copy a browser-generated local file from OpenClaw's browser media directory into the current workspace.",
      "Use this when browser tools return MEDIA:/root/.../media/browser/... paths.",
      "The tool returns a workspace-local MEDIA:/workspace/... or FILE:/workspace/... directive you can safely use in the final reply.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Browser media path or MEDIA:/FILE: directive returned by browser tools.",
        },
        reply_as: {
          type: "string",
          enum: ["auto", "media", "file"],
          description: "Directive prefix to return. auto uses MEDIA for images and FILE for other files.",
        },
        target_name: {
          type: "string",
          description: "Optional output filename under the workspace staging directory.",
        },
      },
      required: ["source"],
      additionalProperties: false,
    },
    async execute(_toolCallId, input) {
      return await executeStageBrowserMedia(input, ctx);
    },
  });
}

export const browserMediaToolTesting = {
  executeStageBrowserMedia,
  toWorkspaceDirectivePath,
};
