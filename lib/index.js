/**
 * sounds-control 宿主端（Node 半）。
 *
 * 职责：把插件包内的 sounds/ 目录通过 HTTP 静态服务暴露给浏览器端。
 *  - GET /dsh-sounds-control/list           -> { sounds: [{name, url}], dir }
 *  - GET /dsh-sounds-control/sounds/<name>  -> 音频文件内容（带 mime）
 *
 * 浏览器端把音频文件放进插件包根目录的 sounds/ 文件夹即可被枚举和播放。
 */
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";

const PREFIX = "/dsh-sounds-control";
const MIME = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wma": "audio/x-ms-wma",
  ".webm": "audio/webm"
};
const EXT = Object.keys(MIME);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(moduleDir, "..");
const SOUNDS_DIR = join(PKG_ROOT, "sounds");
const CONFIG_FILE = join(PKG_ROOT, "config.json");

function isLoopback(req) {
  const addr = req.socket && req.socket.remoteAddress;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr === "localhost";
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache"
  });
  res.end(JSON.stringify(obj));
}

/** Host 头必须是回环主机（防 DNS rebinding）。 */
function isTrustedHost(req) {
  const host = req.headers["host"];
  return typeof host === "string" && /^(127\.0\.0\.1|localhost|::1)(:\d+)?$/.test(host);
}

/** 流式输出文件；读取出错时安全收尾（不崩溃进程）。 */
function pipeFile(file, opts, res) {
  const stream = createReadStream(file, opts);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(404);
      res.end();
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

/** 读取 JSON 请求体（上限 64KB）。 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 65536) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

async function handler(req, res) {
  if (!isLoopback(req) || !isTrustedHost(req)) {
    sendJson(res, 403, { error: "loopback-only" });
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url || "/", "http://x").pathname;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  // 仅 /config 允许 POST，其余只允许 GET/HEAD
  if (req.method === "POST" && pathname !== PREFIX + "/config") {
    res.writeHead(405);
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }

  // 配置读写（宿主端文件持久化，避免浏览器 localStorage 被清空导致配置丢失）
  if (pathname === PREFIX + "/config") {
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (body === null || typeof body !== "object") {
        sendJson(res, 400, { error: "bad json body" });
        return;
      }
      try {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(body, null, 2), "utf8");
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: "config write failed", detail: String((err && err.message) || err) });
      }
      return;
    }
    try {
      const raw = await fs.readFile(CONFIG_FILE, "utf8");
      sendJson(res, 200, JSON.parse(raw));
    } catch {
      sendJson(res, 200, {});
    }
    return;
  }

  // 音效列表
  if (pathname === PREFIX + "/list") {
    try {
      await fs.mkdir(SOUNDS_DIR, { recursive: true });
      const entries = await fs.readdir(SOUNDS_DIR);
      const sounds = entries
        .filter((n) => EXT.includes(extname(n).toLowerCase()))
        .sort()
        .map((n) => ({ name: n, url: PREFIX + "/sounds/" + encodeURIComponent(n) }));
      sendJson(res, 200, { sounds, dir: SOUNDS_DIR });
    } catch (err) {
      sendJson(res, 500, { error: "list failed", detail: String((err && err.message) || err) });
    }
    return;
  }

  // 音频文件（标准流式媒体服务：Range/206 分片、ETag/304、HEAD、流式传输）
  const soundsPrefix = PREFIX + "/sounds/";
  if (pathname.startsWith(soundsPrefix)) {
    let name;
    try {
      name = decodeURIComponent(pathname.slice(soundsPrefix.length));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const ext = extname(name).toLowerCase();
    if (!EXT.includes(ext)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const file = join(SOUNDS_DIR, name);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    const size = stat.size;
    const etag = '"' + size + "-" + Math.round(stat.mtimeMs).toString(16) + '"';
    const baseHeaders = {
      "content-type": MIME[ext],
      "accept-ranges": "bytes",
      "etag": etag,
      "last-modified": new Date(stat.mtimeMs).toUTCString(),
      // 允许浏览器缓存复用（1 小时），避免每次播放都回源重新加载
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff"
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, baseHeaders);
      res.end();
      return;
    }
    // 解析 Range: bytes=start-end / bytes=start- / bytes=-suffix
    let start = 0;
    let end = size - 1;
    let useRange = false;
    const rangeHeader = req.headers["range"];
    if (typeof rangeHeader === "string") {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const rs = m[1] === "" ? undefined : parseInt(m[1], 10);
        const re = m[2] === "" ? undefined : parseInt(m[2], 10);
        if (rs !== undefined && re !== undefined && rs <= re) {
          start = rs; end = Math.min(re, size - 1); useRange = true;
        } else if (rs !== undefined && re === undefined) {
          start = rs; end = size - 1; useRange = true;
        } else if (rs === undefined && re !== undefined) {
          start = Math.max(0, size - re); end = size - 1; useRange = true;
        }
      }
    }
    if (useRange) {
      if (start >= size) {
        res.writeHead(416, Object.assign({}, baseHeaders, { "content-range": "bytes */" + size }));
        res.end();
        return;
      }
      res.writeHead(206, Object.assign({}, baseHeaders, {
        "content-length": end - start + 1,
        "content-range": "bytes " + start + "-" + end + "/" + size
      }));
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      pipeFile(file, { start, end }, res);
      return;
    }
    res.writeHead(200, Object.assign({}, baseHeaders, { "content-length": size }));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    pipeFile(file, undefined, res);
    return;
  }

  res.writeHead(404);
  res.end();
}

const name = "ui-sounds-control-host";
const inject = ["webServer"];

async function apply(ctx) {
  await fs.mkdir(SOUNDS_DIR, { recursive: true });
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: PREFIX, handler }));
}

export { apply, inject, name };
