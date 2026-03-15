import { basename } from "node:path";
import { logger } from "../logger.js";
import { loadOutboundMediaFromUrl, detectMime, getExtendedMediaLocalRoots } from "./openclaw-compat.js";
import {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VOICE_MAX_BYTES,
  ABSOLUTE_MAX_BYTES,
} from "./constants.js";

const VOICE_SUPPORTED_MIMES = new Set(["audio/amr"]);

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/amr": ".amr",
  "audio/aac": ".aac",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
};

export function detectWeComMediaType(mimeType) {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/") || mime === "application/ogg") return "voice";
  return "file";
}

export function mimeToExtension(mime) {
  return MIME_TO_EXT[mime] || ".bin";
}

export function extractFileName(mediaUrl, providedFileName, contentType) {
  if (providedFileName) return providedFileName;

  try {
    const urlObj = new URL(mediaUrl, "file://");
    const lastPart = urlObj.pathname.split("/").pop();
    if (lastPart?.includes(".")) return decodeURIComponent(lastPart);
  } catch {
    const lastPart = String(mediaUrl).split("/").pop();
    if (lastPart?.includes(".")) return lastPart;
  }

  return `media_${Date.now()}${mimeToExtension(contentType || "application/octet-stream")}`;
}

export function applyFileSizeLimits(fileSize, detectedType, contentType) {
  const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

  if (fileSize > ABSOLUTE_MAX_BYTES) {
    return {
      finalType: detectedType,
      shouldReject: true,
      rejectReason: `文件大小 ${fileSizeMB}MB 超过了企业微信允许的最大限制 20MB，无法发送。请尝试压缩文件或减小文件大小。`,
      downgraded: false,
    };
  }

  switch (detectedType) {
    case "image":
      if (fileSize > IMAGE_MAX_BYTES) {
        return {
          finalType: "file",
          shouldReject: false,
          downgraded: true,
          downgradeNote: `图片大小 ${fileSizeMB}MB 超过 10MB 限制，已转为文件格式发送`,
        };
      }
      break;
    case "video":
      if (fileSize > VIDEO_MAX_BYTES) {
        return {
          finalType: "file",
          shouldReject: false,
          downgraded: true,
          downgradeNote: `视频大小 ${fileSizeMB}MB 超过 10MB 限制，已转为文件格式发送`,
        };
      }
      break;
    case "voice":
      if (contentType && !VOICE_SUPPORTED_MIMES.has(contentType.toLowerCase())) {
        return {
          finalType: "file",
          shouldReject: false,
          downgraded: true,
          downgradeNote: `语音格式 ${contentType} 不支持，企微仅支持 AMR 格式，已转为文件格式发送`,
        };
      }
      if (fileSize > VOICE_MAX_BYTES) {
        return {
          finalType: "file",
          shouldReject: false,
          downgraded: true,
          downgradeNote: `语音大小 ${fileSizeMB}MB 超过 2MB 限制，已转为文件格式发送`,
        };
      }
      break;
  }

  return { finalType: detectedType, shouldReject: false, downgraded: false };
}

async function resolveMediaFile(mediaUrl, mediaLocalRoots, includeDefaultMediaLocalRoots = true) {
  const result = await loadOutboundMediaFromUrl(mediaUrl, {
    maxBytes: ABSOLUTE_MAX_BYTES,
    mediaLocalRoots,
    includeDefaultMediaLocalRoots,
  });

  if (!result.buffer || result.buffer.length === 0) {
    throw new Error(`Failed to load media from ${mediaUrl}: empty buffer`);
  }

  let contentType = result.contentType || "application/octet-stream";
  if (contentType === "application/octet-stream" || contentType === "text/plain") {
    const detected = await detectMime(result.buffer);
    if (detected) contentType = detected;
  }

  return {
    buffer: result.buffer,
    contentType,
    fileName: extractFileName(mediaUrl, result.fileName, contentType),
  };
}

export function buildMediaErrorSummary(mediaUrl, result) {
  if (result.error?.includes("LocalMediaAccessError")) {
    return `文件发送失败：没有权限访问路径 ${mediaUrl}\n请在 openclaw.json 的 mediaLocalRoots 中添加该路径的父目录后重启生效。`;
  }
  if (result.rejectReason) {
    return `文件发送失败：${result.rejectReason}`;
  }
  return `文件发送失败：无法处理文件 ${mediaUrl}，请稍后再试。`;
}

export async function uploadAndSendMedia({
  wsClient,
  mediaUrl,
  chatId,
  mediaLocalRoots,
  includeDefaultMediaLocalRoots = true,
  log,
  errorLog,
}) {
  try {
    log?.(`[wecom] Uploading media: url=${mediaUrl}`);
    const media = await resolveMediaFile(mediaUrl, mediaLocalRoots, includeDefaultMediaLocalRoots);
    const detectedType = detectWeComMediaType(media.contentType);
    const sizeCheck = applyFileSizeLimits(media.buffer.length, detectedType, media.contentType);

    if (sizeCheck.shouldReject) {
      errorLog?.(`[wecom] Media rejected: ${sizeCheck.rejectReason}`);
      return {
        ok: false,
        rejected: true,
        rejectReason: sizeCheck.rejectReason,
        finalType: sizeCheck.finalType,
      };
    }

    const finalType = sizeCheck.finalType;
    const uploadResult = await wsClient.uploadMedia(media.buffer, {
      type: finalType,
      filename: media.fileName,
    });
    log?.(`[wecom] Media uploaded: media_id=${uploadResult.media_id}, type=${finalType}`);

    const result = await wsClient.sendMediaMessage(chatId, finalType, uploadResult.media_id);
    const messageId = result?.headers?.req_id ?? `wecom-media-${Date.now()}`;
    log?.(`[wecom] Media sent via sendMediaMessage: chatId=${chatId}, type=${finalType}`);

    return {
      ok: true,
      messageId,
      finalType,
      downgraded: sizeCheck.downgraded,
      downgradeNote: sizeCheck.downgradeNote,
    };
  } catch (err) {
    const errMsg = String(err);
    errorLog?.(`[wecom] Failed to upload/send media: url=${mediaUrl}, error=${errMsg}`);
    return { ok: false, error: errMsg };
  }
}

export const mediaUploaderTesting = {
  resolveMediaFile,
  VOICE_SUPPORTED_MIMES,
};
