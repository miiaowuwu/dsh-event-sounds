/**
 * dsh-sound-lab 宿主端（Node 半）。
 *
 * 职责：把插件包内的 sounds/ 目录通过 HTTP 静态服务暴露给浏览器端。
 *  - GET /dsh-sounds-control/list           -> { sounds: [{name, url}], dir }
 *  - GET /dsh-sounds-control/sounds/<name>  -> 音频文件内容（带 mime）
 *
 * 浏览器端把音频文件放进插件包根目录的 sounds/ 文件夹即可被枚举和播放。
 */
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { createReadStream, existsSync } from "node:fs";
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
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 自定义音效上传上限 20MB

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(moduleDir, "..");
const SOUNDS_DIR = join(PKG_ROOT, "sounds");
const CONFIG_FILE = join(PKG_ROOT, "config.json");
// AI 生成音频统一放在 sounds/generated/ 下（不经「选择」也可被音效库 manifest 直接引用）
const GENERATED_DIR = join(SOUNDS_DIR, "generated");
// 音效库控制文件：记录每个音效的显示名与相对 sounds/ 的路径（支持 generated/ 子目录引用）
const MANIFEST_FILE = join(SOUNDS_DIR, "sounds.json");
const MANIFEST_KEY = "sounds";
// 教程图片：开发环境优先用 tools/api 原图，发布包内用 lib/tutorial 的副本
const TUTORIAL_DIR = existsSync(join(PKG_ROOT, "tools", "api")) ? join(PKG_ROOT, "tools", "api") : join(moduleDir, "tutorial");
const TUTORIAL_IMAGES = ["image1.png", "image2.png"];

// ---- 百炼 CosyVoice 语音合成（与 tools/api/tts_api.py 同协议）----
const TTS_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
const TTS_MODEL = "cosyvoice-v3.5-plus"; // 音质较好；与控制台创建音色时的 target_model 需一致
const TTS_SAMPLE_RATE = 24000;
const TTS_MAX_CHARS = 500; // 单次请求最大字符数，超长文本按句切分
const TTS_REQ_TIMEOUT = 180000; // 合成请求超时（ms）
const TTS_DL_TIMEOUT = 120000; // 下载音频超时（ms）
const TTS_CONFIG_KEY = "tts"; // config.json 中存放 { apiKey, voiceId } 的键
// 附带音效（与客户端 BUILTIN_SOUNDS 一致）：不可删除/重命名，只能软隐藏
const BUILTIN_SOUNDS = ["「hirari do～」.mp3", "呢？.mp3", "啊哇哇！.mp3"];
// 文件名白名单校验：只允许纯文件名（无路径分隔），禁止 . 开头
const SAFE_NAME = /^[^\\/]+$/;

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

/** 读取原始请求体（上传音频用，上限 20MB）。 */
function readRawBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", () => resolve(null));
  });
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

/** 通用文件服务：ETag/304、Range/206、HEAD、流式输出（音频 / 教程图片共用）。 */
async function serveFile(file, req, res, contentType) {
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
    "content-type": contentType,
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
}

/** 音频文件服务：mime 由扩展名决定。 */
function serveAudioFile(file, req, res) {
  return serveFile(file, req, res, MIME[extname(file).toLowerCase()] || "application/octet-stream");
}

// ==================== 百炼 CosyVoice TTS（AI 生成角色音频） ====================

/** 读取 config.json（不存在返回 {}）。 */
async function readConfigJson() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

/** 读 TTS 配置：{ apiKey, voiceId, model }。 */
async function getTtsConfig() {
  const cfg = await readConfigJson();
  const tts = (cfg && cfg[TTS_CONFIG_KEY]) || {};
  return {
    apiKey: typeof tts.apiKey === "string" ? tts.apiKey : "",
    voiceId: typeof tts.voiceId === "string" ? tts.voiceId : "",
    model: TTS_MODEL,
  };
}

/** 保存 TTS 配置（只改 config.json 的 tts 子键，不动其它配置）。 */
async function saveTtsConfig(patch) {
  const cfg = await readConfigJson();
  const next = Object.assign({}, cfg[TTS_CONFIG_KEY] || {}, patch);
  await fs.writeFile(CONFIG_FILE, JSON.stringify(Object.assign({}, cfg, { [TTS_CONFIG_KEY]: next }), null, 2), "utf8");
  return next;
}

/** 按句子边界切分长文本，避免单次请求超限（与 tts_api.py 一致）。 */
function splitText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let cur = "";
  for (const seg of text.split("。")) {
    const piece = seg + "。";
    if (cur.length + piece.length > maxChars && cur) {
      chunks.push(cur);
      cur = "";
    }
    cur += piece;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** fetch 带超时（AbortController 实现，兼容旧 Node）。 */
async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/** 解析 WAV 头，返回 { channels, sampleRate, bitsPerSample, dataStart, dataLen }。 */
function parseWav(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("不是有效的 WAV 文件");
  }
  let fmt = null;
  let dataStart = -1;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = {
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === "data") {
      dataStart = off + 8;
      dataLen = sz;
    }
    off += 8 + sz + (sz % 2); // 块按 2 字节对齐
  }
  if (!fmt || dataStart < 0) throw new Error("WAV 缺少 fmt 或 data 块");
  return { fmt, dataStart, dataLen };
}

/** 用 fmt + 全部 data 重建一个标准 PCM WAV。 */
function buildWav(fmt, data) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(fmt.channels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(fmt.sampleRate * fmt.channels * fmt.bitsPerSample / 8, 28);
  header.writeUInt16LE(fmt.channels * fmt.bitsPerSample / 8, 32);
  header.writeUInt16LE(fmt.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** 多段 WAV 按帧拼接（长文本分段合成时合为一个文件，与 tts_api.py 行为一致）。 */
function concatWavs(buffers) {
  const first = parseWav(buffers[0]);
  const dataParts = [buffers[0].subarray(first.dataStart, first.dataStart + first.dataLen)];
  for (let i = 1; i < buffers.length; i++) {
    const cur = parseWav(buffers[i]);
    if (cur.fmt.channels !== first.fmt.channels || cur.fmt.sampleRate !== first.fmt.sampleRate ||
        cur.fmt.bitsPerSample !== first.fmt.bitsPerSample) {
      throw new Error("分段音频格式不一致，无法拼接");
    }
    dataParts.push(buffers[i].subarray(cur.dataStart, cur.dataStart + cur.dataLen));
  }
  return buildWav(first.fmt, Buffer.concat(dataParts));
}

/**
 * 调用百炼 SpeechSynthesizer 合成文本，返回合并后的 wav Buffer。
 * 计费字符数在返回的 chars 中统计。
 */
async function synthesizeSpeech(text, apiKey, voiceId) {
  const chunks = splitText(text, TTS_MAX_CHARS);
  const wavs = [];
  let totalChars = 0;
  for (const chunk of chunks) {
    const payload = {
      model: TTS_MODEL,
      input: { text: chunk, voice: voiceId },
      format: "wav",
      sample_rate: TTS_SAMPLE_RATE,
    };
    let resp;
    try {
      resp = await fetchWithTimeout(TTS_ENDPOINT, {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, TTS_REQ_TIMEOUT);
    } catch (err) {
      throw new Error("请求百炼接口失败：" + String((err && err.message) || err));
    }
    const body = await resp.text();
    let obj;
    try {
      obj = JSON.parse(body);
    } catch {
      throw new Error("百炼返回非 JSON：" + body.slice(0, 300));
    }
    if (!resp.ok) {
      const hint = resp.status === 400 && /voice/i.test(body)
        ? "（请确认音色ID正确，且与控制台创建音色时选择的模型一致）" : "";
      throw new Error("合成失败 (HTTP " + resp.status + ")：" + body.slice(0, 300) + hint);
    }
    const audioUrl = obj.output && obj.output.audio && obj.output.audio.url;
    if (!audioUrl) throw new Error("百炼响应中无音频 URL：" + body.slice(0, 300));
    totalChars += (obj.usage && obj.usage.characters) || 0;
    const dl = await fetchWithTimeout(audioUrl, {}, TTS_DL_TIMEOUT);
    if (!dl.ok) throw new Error("下载合成音频失败 (HTTP " + dl.status + ")");
    wavs.push(Buffer.from(await dl.arrayBuffer()));
  }
  return { wav: concatWavs(wavs), chars: totalChars };
}

/** 生成文件名：ai_YYYYMMDD_HHMMSS.wav */
function genFileName(now) {
  const d = now || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return "ai_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + ".wav";
}

/** 列出 generated/ 目录下的音频（URL 与音效库统一为 /sounds/generated/，保证浏览器缓存共享） */
async function listGenerated() {
  try {
    await fs.mkdir(GENERATED_DIR, { recursive: true });
    const entries = await fs.readdir(GENERATED_DIR);
    return entries
      .filter((n) => MIME[extname(n).toLowerCase()])
      .sort()
      .map((n) => ({ name: n, url: PREFIX + "/sounds/" + encodeURIComponent("generated/" + n) }));
  } catch {
    return [];
  }
}

// ==================== 音效库 manifest（sounds/sounds.json 控制文件） ====================
// 条目：{ name, path, kind }，kind 用于区分音效来源：ai=AI生成 | local=上传/本地 | bundled=附带
/** 推断条目 kind（附带音效优先判定，兼容旧 manifest 无 kind / 旧 kind 未标 bundled） */
function inferKind(entry) {
  if (BUILTIN_SOUNDS.includes(entry.name)) return "bundled";
  if (typeof entry.kind === "string" && entry.kind) return entry.kind;
  if (typeof entry.path === "string" && entry.path.startsWith("generated/")) return "ai";
  return "local";
}

/** 读取 manifest：{ sounds: [{ name, path, kind }] }，并对账补录磁盘上未登记的音效（上传/手动放入的都会被记录） */
async function readManifest() {
  let sounds = null;
  try {
    const raw = await fs.readFile(MANIFEST_FILE, "utf8");
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj[MANIFEST_KEY])) {
      sounds = obj[MANIFEST_KEY]
        .filter((s) => s && typeof s.name === "string" && typeof s.path === "string")
        .map((s) => Object.assign({}, s, { kind: inferKind(s) }));
    }
  } catch { /* 不存在或损坏 → 全新初始化 */ }
  if (sounds === null) sounds = [];

  // 对账：磁盘上存在但 manifest 未登记的音频自动补录（覆盖旧版上传 / 手动放入 / 老版本生成）
  const known = new Set(sounds.map((s) => s.path));
  const add = [];
  const rootEntries = await fs.readdir(SOUNDS_DIR).catch(() => []);
  for (const n of rootEntries) {
    if (n === "sounds.json" || !EXT.includes(extname(n).toLowerCase()) || known.has(n)) continue;
    const st = await fs.stat(join(SOUNDS_DIR, n)).catch(() => null);
    if (st && st.isFile()) {
      const entry = { name: n, path: n };
      add.push(Object.assign({}, entry, { kind: inferKind(entry) }));
    }
  }
  const genEntries = await fs.readdir(GENERATED_DIR).catch(() => []);
  for (const n of genEntries) {
    const p = "generated/" + n;
    if (!MIME[extname(n).toLowerCase()] || known.has(p)) continue;
    const st = await fs.stat(join(GENERATED_DIR, n)).catch(() => null);
    if (st && st.isFile()) add.push({ name: n, path: p, kind: "ai" });
  }
  if (add.length) {
    sounds = sounds.concat(add).sort((a, b) => (a.name < b.name ? -1 : 1));
    await writeManifest(sounds).catch(() => { /* 只读环境不阻断 */ });
  }
  return sounds;
}

async function writeManifest(sounds) {
  await fs.writeFile(MANIFEST_FILE, JSON.stringify({ [MANIFEST_KEY]: sounds }, null, 2), "utf8");
}

/** 登记音效（同名覆盖，kind 区分来源）；返回最新列表 */
async function manifestAdd(name, path, kind) {
  const sounds = await readManifest();
  const next = sounds.filter((s) => s.name !== name);
  next.push({ name, path, kind: kind || inferKind({ name, path }) });
  await writeManifest(next);
  return next;
}

/** 按路径移除音效 */
async function manifestRemoveByPath(path) {
  const sounds = await readManifest();
  const next = sounds.filter((s) => s.path !== path);
  if (next.length !== sounds.length) await writeManifest(next);
  return next;
}

/** 重命名音效条目（保留原 kind，移除旧名，登记新名/新路径） */
async function manifestRename(oldName, newName, newPath) {
  const sounds = await readManifest();
  const old = sounds.find((s) => s.name === oldName);
  const next = sounds.filter((s) => s.name !== oldName).filter((s) => s.name !== newName);
  next.push({ name: newName, path: newPath, kind: old ? old.kind : "local" });
  await writeManifest(next);
  return next;
}

/** 校验音效相对路径：允许纯文件名或 generated/<文件名>，非法返回 null */
function safeSoundPath(p) {
  if (!p || p.startsWith(".")) return null;
  const parts = p.split("/");
  if (parts.length === 1 && SAFE_NAME.test(parts[0])) return parts[0];
  if (parts.length === 2 && parts[0] === "generated" && SAFE_NAME.test(parts[1])) return p;
  return null;
}

/** 清洗用户输入的文件名：去掉路径分隔与非法字符、尾部点/空格，返回干净名（可能为空） */
function sanitizeFileName(name) {
  if (typeof name !== "string") return "";
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").replace(/[\s.]+$/, "").trim();
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
  // 仅以下路径允许 POST（其余 GET/HEAD/DELETE 按各自路由处理）
  if (req.method === "POST" && pathname !== PREFIX + "/config" && pathname !== PREFIX + "/sounds/upload" &&
      pathname !== PREFIX + "/sounds/rename" &&
      pathname !== PREFIX + "/tts/config" && pathname !== PREFIX + "/tts/generate" &&
      !pathname.startsWith(PREFIX + "/tts/generated/")) {
    res.writeHead(405);
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST" && req.method !== "DELETE") {
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

  // 上传自定义音效：浏览器端选择/拖拽音频文件 → 写入插件 sounds/ 目录
  if (pathname === PREFIX + "/sounds/upload" && req.method === "POST") {
    let qname = "";
    try {
      qname = new URL(req.url || "/", "http://x").searchParams.get("name") || "";
    } catch {
      qname = "";
    }
    let name;
    try {
      name = decodeURIComponent(qname).trim();
    } catch {
      name = "";
    }
    const ext = extname(name).toLowerCase();
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || !EXT.includes(ext)) {
      sendJson(res, 400, { error: "invalid filename", detail: "supported: " + EXT.join(" / ") });
      return;
    }
    const buf = await readRawBody(req, MAX_UPLOAD_BYTES);
    if (buf === null) {
      sendJson(res, 413, { error: "file too large", detail: "max " + MAX_UPLOAD_BYTES + " bytes" });
      return;
    }
    try {
      await fs.mkdir(SOUNDS_DIR, { recursive: true });
      await fs.writeFile(join(SOUNDS_DIR, name), buf);
      await manifestAdd(name, name, "local"); // 登记进音效库控制文件（本地/上传）
      sendJson(res, 200, { ok: true, name });
    } catch (err) {
      sendJson(res, 500, { error: "upload failed", detail: String((err && err.message) || err) });
    }
    return;
  }

  // 重命名音效：POST /sounds/rename { name, newName } → 改文件名 + 更新 manifest（附带音效禁止）
  if (pathname === PREFIX + "/sounds/rename" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (body === null || typeof body !== "object" || typeof body.name !== "string" || typeof body.newName !== "string") {
      sendJson(res, 400, { error: "bad json body" });
      return;
    }
    const name = body.name.trim();
    const newName = sanitizeFileName(body.newName);
    if (!name || !newName) {
      sendJson(res, 400, { error: "bad name", message: "名字不能为空" });
      return;
    }
    if (BUILTIN_SOUNDS.includes(name)) {
      sendJson(res, 403, { error: "builtin", message: "附带音效不可重命名" });
      return;
    }
    const sounds = await readManifest();
    const entry = sounds.find((s) => s.name === name);
    if (!entry) {
      sendJson(res, 404, { error: "not found", message: "音效不存在：" + name });
      return;
    }
    // 保持原扩展名（用户未带扩展名时自动补）；目标路径与源保持一致（sounds/ 或 generated/）
    const oldExt = extname(entry.path).toLowerCase();
    const finalName = newName.toLowerCase().endsWith(oldExt) ? newName : newName + oldExt;
    const parts = entry.path.split("/");
    const isGen = parts.length === 2 && parts[0] === "generated";
    const newPath = isGen ? "generated/" + finalName : finalName;
    const oldFile = join(SOUNDS_DIR, ...parts);
    const newFile = join(SOUNDS_DIR, ...newPath.split("/"));
    if (await fs.access(newFile).then(() => true, () => false)) {
      sendJson(res, 409, { error: "name_exists", message: "已存在同名文件：" + finalName });
      return;
    }
    try {
      await fs.rename(oldFile, newFile);
      await manifestRename(name, finalName, newPath);
      sendJson(res, 200, { ok: true, name: finalName, path: newPath });
    } catch (err) {
      sendJson(res, 500, { error: "rename failed", detail: String((err && err.message) || err) });
    }
    return;
  }

  // 音效列表（由 manifest 控制文件驱动：name 为显示名，path 为相对 sounds/ 的路径，kind 区分来源）
  if (pathname === PREFIX + "/list") {
    try {
      await fs.mkdir(SOUNDS_DIR, { recursive: true });
      const sounds = (await readManifest())
        .map((s) => ({ name: s.name, path: s.path, kind: s.kind || "local", url: PREFIX + "/sounds/" + encodeURIComponent(s.path) }));
      sendJson(res, 200, { sounds, dir: SOUNDS_DIR });
    } catch (err) {
      sendJson(res, 500, { error: "list failed", detail: String((err && err.message) || err) });
    }
    return;
  }

  // 音频文件（标准流式媒体服务：Range/206 分片、ETag/304、HEAD、流式传输）
  // path 允许纯文件名（sounds/ 下）或 generated/<文件名>（AI 生成，经 manifest 引用，无需复制）
  const soundsPrefix = PREFIX + "/sounds/";
  if (pathname.startsWith(soundsPrefix)) {
    let raw;
    try {
      raw = decodeURIComponent(pathname.slice(soundsPrefix.length));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const rel = safeSoundPath(raw);
    if (!rel) {
      res.writeHead(403);
      res.end();
      return;
    }
    const file = join(SOUNDS_DIR, ...rel.split("/"));
    // 删除音效文件（前端对附带默认音效走本地软删，不调用此接口）
    if (req.method === "DELETE") {
      try {
        await fs.unlink(file);
        await manifestRemoveByPath(rel); // 同步从音效库控制文件移除
        sendJson(res, 200, { ok: true, name: rel });
      } catch (err) {
        if (err && err.code === "ENOENT") sendJson(res, 404, { error: "not found" });
        else sendJson(res, 500, { error: "delete failed", detail: String((err && err.message) || err) });
      }
      return;
    }
    // 通用流式文件服务：ETag/304、Range/206、HEAD、流式传输
    return serveAudioFile(file, req, res);
  }

  // ==================== AI 生成角色音频（百炼 CosyVoice TTS） ====================

  // TTS 配置读写：GET 返回 { apiKey, voiceId, model }；POST 保存（只动 tts 子键）
  if (pathname === PREFIX + "/tts/config") {
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (body === null || typeof body !== "object") {
        sendJson(res, 400, { error: "bad json body" });
        return;
      }
      try {
        const next = await saveTtsConfig({
          apiKey: typeof body.apiKey === "string" ? body.apiKey.trim() : "",
          voiceId: typeof body.voiceId === "string" ? body.voiceId.trim() : "",
        });
        sendJson(res, 200, { ok: true, config: next });
      } catch (err) {
        sendJson(res, 500, { error: "tts config save failed", detail: String((err && err.message) || err) });
      }
      return;
    }
    sendJson(res, 200, await getTtsConfig());
    return;
  }

  // 生成：POST { text, apiKey?, voiceId?, name? } → 合成 wav 存 sounds/generated/，返回 { name, url, chars }
  // 凭据优先用请求体携带的（输入即用，不依赖异步保存），否则回退已保存配置；成功后一并持久化
  // name 为可选自定义文件名（不含扩展名，自动补 .wav）；为空用时间戳
  if (pathname === PREFIX + "/tts/generate" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (body === null || typeof body !== "object" || typeof body.text !== "string" || !body.text.trim()) {
      sendJson(res, 400, { error: "text_empty", message: "请输入要合成的文本" });
      return;
    }
    const cfg = await getTtsConfig();
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : cfg.apiKey;
    const voiceId = typeof body.voiceId === "string" && body.voiceId.trim() ? body.voiceId.trim() : cfg.voiceId;
    if (!apiKey || !voiceId) {
      sendJson(res, 400, { error: "no_tts_config", message: "请先配置 API Key 和音色ID" });
      return;
    }
    // 自定义文件名（可选）：清洗非法字符，空则时间戳；自动补 .wav
    const base = sanitizeFileName(body.name) || genFileName().replace(/\.wav$/, "");
    const name = base.toLowerCase().endsWith(".wav") ? base : base + ".wav";
    const outFile = join(GENERATED_DIR, name);
    if (await fs.access(outFile).then(() => true, () => false)) {
      sendJson(res, 409, { error: "name_exists", message: "文件已存在：" + name + "，请换个名字" });
      return;
    }
    try {
      await fs.mkdir(GENERATED_DIR, { recursive: true });
      const { wav, chars } = await synthesizeSpeech(body.text.trim(), apiKey, voiceId);
      if (apiKey !== cfg.apiKey || voiceId !== cfg.voiceId) {
        try { await saveTtsConfig({ apiKey, voiceId }); } catch (err) { /* 持久化失败不阻断合成 */ }
      }
      await fs.writeFile(outFile, wav);
      // 自动登记进音效库（kind=ai）：重启后依然在 manifest 中，音效库直接引用
      await manifestAdd(name, "generated/" + name, "ai");
      sendJson(res, 200, {
        ok: true, name,
        path: "generated/" + name,
        kind: "ai",
        url: PREFIX + "/sounds/" + encodeURIComponent("generated/" + name),
        chars,
        size: wav.length,
      });
    } catch (err) {
      sendJson(res, 500, { error: "tts_failed", message: String((err && err.message) || err) });
    }
    return;
  }

  // 已生成列表
  if (pathname === PREFIX + "/tts/generated") {
    sendJson(res, 200, { sounds: await listGenerated(), dir: GENERATED_DIR });
    return;
  }

  // 已生成音频：GET 预览 / DELETE 删除 / POST .../select 复制进 sounds/
  const genPrefix = PREFIX + "/tts/generated/";
  if (pathname.startsWith(genPrefix)) {
    let raw;
    try {
      raw = decodeURIComponent(pathname.slice(genPrefix.length));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    // POST .../select：去掉尾部动作再校验文件名
    const isSelect = req.method === "POST" && raw.endsWith("/select");
    const name = isSelect ? raw.slice(0, -"/select".length) : raw;
    if (!name || !SAFE_NAME.test(name) || name.startsWith(".") || !MIME[extname(name).toLowerCase()]) {
      res.writeHead(403);
      res.end();
      return;
    }
    const file = join(GENERATED_DIR, name);
    if (req.method === "DELETE") {
      try {
        await fs.unlink(file);
        await manifestRemoveByPath("generated/" + name); // 若已登记进音效库，同步移除
        sendJson(res, 200, { ok: true, name });
      } catch (err) {
        if (err && err.code === "ENOENT") sendJson(res, 404, { error: "not found" });
        else sendJson(res, 500, { error: "delete failed", detail: String((err && err.message) || err) });
      }
      return;
    }
    if (req.method === "POST") {
      // 选择：确保该生成音频已登记进音效库（幂等；生成成功后已自动登记）
      try {
        await manifestAdd(name, "generated/" + name, "ai");
        sendJson(res, 200, {
          ok: true, name,
          path: "generated/" + name,
          kind: "ai",
          url: PREFIX + "/sounds/" + encodeURIComponent("generated/" + name),
        });
      } catch (err) {
        sendJson(res, 500, { error: "register failed", detail: String((err && err.message) || err) });
      }
      return;
    }
    return serveAudioFile(file, req, res);
  }

  // 教程图片：开发环境读 tools/api 原图，发布包内读 lib/tutorial 副本
  const tutPrefix = PREFIX + "/tts/tutorial/";
  if (pathname.startsWith(tutPrefix)) {
    let tutName;
    try {
      tutName = decodeURIComponent(pathname.slice(tutPrefix.length));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!TUTORIAL_IMAGES.includes(tutName)) {
      res.writeHead(403);
      res.end();
      return;
    }
    return serveFile(join(TUTORIAL_DIR, tutName), req, res, tutName.endsWith(".png") ? "image/png" : "application/octet-stream");
  }

  res.writeHead(404);
  res.end();
}

const name = "ui-event-sounds-host";
const inject = ["webServer"];

async function apply(ctx) {
  await fs.mkdir(SOUNDS_DIR, { recursive: true });
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: PREFIX, handler }));
}

export { apply, inject, name };
