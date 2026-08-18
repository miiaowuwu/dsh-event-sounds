// dsh-event-sounds 宿主端接口冒烟测试（运行：node tools/test-host.mjs）
//
// 用 fake ctx 捕获 webServer 路由注册，再起一个真实 http.Server 把 handler 挂上去，
// 用 fetch 对 list / config / upload / delete 与 TTS（AI 生成角色音频）接口做端到端冒烟断言。
// TTS 仅测配置校验与文件流转，不触达真实百炼 API。
// 对插件目录的写入（config.json / sounds 上传 / generated）均会在结束时清理或恢复原状。
import { createServer, request as httpRequest } from "node:http";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { apply, inject, name } from "../lib/index.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(moduleDir, "..");
const SOUNDS_DIR = join(PKG_ROOT, "sounds");
const CONFIG_FILE = join(PKG_ROOT, "config.json");
const GENERATED_DIR = join(SOUNDS_DIR, "generated");
const MANIFEST_FILE = join(SOUNDS_DIR, "sounds.json");
const TEST_SOUND = "__smoke-test.wav";
const TEST_GEN = "__smoke-gen.wav";
const PREFIX = "/dsh-sounds-control";

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log("PASS", label);
  else { failures++; console.log("FAIL", label); }
};

// ---------- 1) 导出与路由注册 ----------
ok(name === "ui-event-sounds-host", "导出 name = ui-event-sounds-host");
ok(Array.isArray(inject) && inject.includes("webServer"), "导出 inject 包含 webServer");

let registered = null;
await apply({
  webServer: { register: (opts) => { registered = opts; return () => {}; } },
  effect: (fn) => fn(),
});
ok(registered && registered.kind === "prefix" && registered.path === PREFIX, "以 prefix 注册 " + PREFIX);
ok(typeof registered.handler === "function", "捕获到 handler 函数");

// ---------- 2) 真实 HTTP 冒烟 ----------
mkdirSync(SOUNDS_DIR, { recursive: true });
const hadConfig = existsSync(CONFIG_FILE);
const configBackup = hadConfig ? readFileSync(CONFIG_FILE, "utf8") : null;
const hadManifest = existsSync(MANIFEST_FILE);
const manifestBackup = hadManifest ? readFileSync(MANIFEST_FILE, "utf8") : null;

const server = createServer((req, res) => registered.handler(req, res));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

function rawReq(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", () => resolve({ status: -1, headers: {}, text: "", json: null }));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const get = (p, h) => rawReq("GET", PREFIX + p, { headers: h });
const post = (p, body, h) => rawReq("POST", PREFIX + p, { headers: h, body });
const del = (p, h) => rawReq("DELETE", PREFIX + p, { headers: h });

try {
  // list：返回音效列表
  let r = await get("/list");
  ok(r.status === 200 && Array.isArray(r.json && r.json.sounds), "GET /list 返回 { sounds: [...] }");
  ok(r.json.dir === SOUNDS_DIR, "list 暴露 sounds 目录");
  const listed = (r.json.sounds || []).map((s) => s.name);

  // list 方法限制：POST 不允许
  r = await post("/list", "x", { "content-type": "text/plain" });
  ok(r.status === 405, "POST /list 返回 405");

  // config：初始读取（无文件时 {}）
  r = await get("/config");
  ok(r.status === 200, "GET /config 返回 200");
  const sentCfg = { volume: 0.75, triggers: { end: { on: true, sound: "" } } };
  r = await post("/config", JSON.stringify(sentCfg), { "content-type": "application/json" });
  ok(r.status === 200 && r.json.ok === true, "POST /config 写入成功");
  r = await get("/config");
  ok(r.status === 200 && r.json.volume === 0.75 && r.json.triggers.end.sound === "", "GET /config 回读一致");

  // config：非法 JSON 拒绝
  r = await post("/config", "{bad json", { "content-type": "application/json" });
  ok(r.status === 400, "POST /config 非法 JSON 返回 400");

  // 非回环 Host 拒绝（防 DNS rebinding）
  r = await rawReq("GET", PREFIX + "/list", { headers: { host: "evil.example.com" } });
  ok(r.status === 403, "伪造 Host 返回 403");

  // 音频：播放已有音效（若目录中有）
  if (listed.length) {
    const first = listed[0];
    r = await get("/sounds/" + encodeURIComponent(first));
    ok(r.status === 200 && /^audio\//.test(r.headers["content-type"] || ""), "GET /sounds/<name> 返回音频 " + first);
    ok(Number(r.headers["content-length"]) > 0 && r.headers["accept-ranges"] === "bytes", "音频带 content-length 且支持 Range（accept-ranges: bytes）");
    r = await rawReq("GET", PREFIX + "/sounds/" + encodeURIComponent(first), { headers: { range: "bytes=0-9" } });
    ok(r.status === 206 && /bytes 0-9\//.test(r.headers["content-range"] || ""), "Range 请求返回 206");
  } else {
    console.log("SKIP 音频播放断言（sounds/ 目录为空）");
  }
  r = await get("/sounds/" + encodeURIComponent("__不存在__.mp3"));
  ok(r.status === 404, "GET 不存在的音效返回 404");

  // upload：写入临时文件 → list 可见 → 可读 → delete 清理
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
  r = await post("/sounds/upload?name=" + encodeURIComponent(TEST_SOUND), wav, { "content-type": "audio/wav" });
  ok(r.status === 200 && r.json.ok === true, "POST /sounds/upload 上传成功");
  r = await get("/list");
  ok((r.json.sounds || []).some((s) => s.name === TEST_SOUND), "上传后 list 可见");
  r = await get("/sounds/" + encodeURIComponent(TEST_SOUND));
  ok(r.status === 200 && r.headers["content-type"] === "audio/wav", "上传的 wav 可读取（mime 正确）");

  // upload：非法文件名拒绝
  r = await post("/sounds/upload?name=" + encodeURIComponent("../evil.mp3"), wav, { "content-type": "audio/mpeg" });
  ok(r.status === 400, "非法文件名上传返回 400");
  r = await post("/sounds/upload?name=" + encodeURIComponent("bad.txt"), wav, { "content-type": "text/plain" });
  ok(r.status === 400, "不支持扩展名上传返回 400");

  // delete：删除后列表不可见
  r = await del("/sounds/" + encodeURIComponent(TEST_SOUND));
  ok(r.status === 200 && r.json.ok === true, "DELETE 删除成功");
  r = await get("/list");
  ok(!(r.json.sounds || []).some((s) => s.name === TEST_SOUND), "删除后 list 不再可见");

  // ---------- 重命名（非附带音效可改，附带音效禁止） ----------
  const RN_A = "__rename-a.wav", RN_B = "__rename-b.wav", RN_C = "__rename-c.wav";
  r = await post("/sounds/upload?name=" + encodeURIComponent(RN_A), wav, { "content-type": "audio/wav" });
  ok(r.status === 200 && r.json.ok === true, "上传 " + RN_A + " 成功");
  r = await post("/sounds/upload?name=" + encodeURIComponent(RN_B), wav, { "content-type": "audio/wav" });
  ok(r.status === 200 && r.json.ok === true, "上传 " + RN_B + " 成功");
  r = await post("/sounds/rename", JSON.stringify({ name: RN_A, newName: "__rename-c" }), { "content-type": "application/json" });
  ok(r.status === 200 && r.json.name === RN_C && r.json.path === RN_C, "重命名成功（自动补扩展名）");
  ok(existsSync(join(SOUNDS_DIR, RN_C)) && !existsSync(join(SOUNDS_DIR, RN_A)), "重命名后文件已改名");
  r = await get("/list");
  ok((r.json.sounds || []).some((s) => s.name === RN_C && s.path === RN_C), "manifest 显示新名");
  // 重命名为已存在 → 409
  r = await post("/sounds/rename", JSON.stringify({ name: RN_C, newName: "__rename-b" }), { "content-type": "application/json" });
  ok(r.status === 409, "重命名为已存在文件返回 409");
  // 附带音效禁止重命名 → 403
  r = await post("/sounds/rename", JSON.stringify({ name: "「hirari do～」.mp3", newName: "xxx" }), { "content-type": "application/json" });
  ok(r.status === 403 && r.json.error === "builtin", "附带音效重命名返回 403 builtin");
  // 清理
  r = await del("/sounds/" + encodeURIComponent(RN_C));
  ok(r.status === 200, "清理重命名测试文件");
  r = await del("/sounds/" + encodeURIComponent(RN_B));
  ok(r.status === 200, "清理冲突测试文件");

  // ---------- 对账：直接放进 sounds/ 的文件也会被自动登记 ----------
  writeFileSync(join(SOUNDS_DIR, "__manual.wav"), wav);
  r = await get("/list");
  ok((r.json.sounds || []).some((s) => s.name === "__manual.wav" && s.path === "__manual.wav" && s.kind === "local"), "手动放入 sounds/ 的文件被自动登记（对账补录）");
  r = await del("/sounds/" + encodeURIComponent("__manual.wav"));
  ok(r.status === 200, "清理手动放入的文件");

  // ---------- TTS（AI 生成角色音频）：仅测配置校验与文件流转，不触达真实百炼 API ----------
  // 配置：初始为空 + 默认模型
  r = await get("/tts/config");
  ok(r.status === 200 && r.json.apiKey === "" && r.json.voiceId === "" && !!r.json.model, "GET /tts/config 返回空配置与默认模型");
  // 保存并回读
  r = await post("/tts/config", JSON.stringify({ apiKey: "sk-test", voiceId: "cosy-123" }), { "content-type": "application/json" });
  ok(r.status === 200 && r.json.ok === true, "POST /tts/config 保存成功");
  r = await get("/tts/config");
  ok(r.status === 200 && r.json.apiKey === "sk-test" && r.json.voiceId === "cosy-123", "GET /tts/config 回读一致");
  // 生成：空文本 → 400 text_empty
  r = await post("/tts/generate", JSON.stringify({ text: "   " }), { "content-type": "application/json" });
  ok(r.status === 400 && r.json.error === "text_empty", "空文本生成返回 400 text_empty");
  // 生成：清除凭据后 → 400 no_tts_config
  await post("/tts/config", JSON.stringify({ apiKey: "", voiceId: "" }), { "content-type": "application/json" });
  r = await post("/tts/generate", JSON.stringify({ text: "你好" }), { "content-type": "application/json" });
  ok(r.status === 400 && r.json.error === "no_tts_config", "未配置 API Key/音色ID 时生成返回 400 no_tts_config");
  // 生成列表（初始为空）
  r = await get("/tts/generated");
  ok(r.status === 200 && Array.isArray(r.json.sounds), "GET /tts/generated 返回列表");
  // 已生成音频：放入假 wav → 列表可见 → 可读 → 选择登记进音效库（不复制）→ 删除
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(join(GENERATED_DIR, TEST_GEN), wav);
  r = await get("/tts/generated");
  ok((r.json.sounds || []).some((s) => s.name === TEST_GEN), "生成列表可见假 wav");
  r = await get("/tts/generated/" + TEST_GEN);
  ok(r.status === 200 && r.headers["content-type"] === "audio/wav", "生成的音频可读取");
  r = await post("/tts/generated/" + TEST_GEN + "/select", "", { "content-type": "text/plain" });
  ok(r.status === 200 && r.json.ok === true, "POST /select 登记成功");
  r = await get("/list");
  const genEntry = (r.json.sounds || []).find((s) => s.path === "generated/" + TEST_GEN);
  ok(!!genEntry && genEntry.url.includes("generated") && genEntry.kind === "ai", "select 后音效库 manifest 出现该引用（kind=ai，不复制文件）");
  ok(!existsSync(join(SOUNDS_DIR, TEST_GEN)), "select 不把文件复制到 sounds/ 根目录");
  r = await del("/tts/generated/" + TEST_GEN);
  ok(r.status === 200 && r.json.ok === true, "DELETE 删除生成音频成功");
  r = await get("/list");
  ok(!(r.json.sounds || []).some((s) => s.path === "generated/" + TEST_GEN), "删除后 manifest 引用同步移除");
  // 非法文件名拒绝
  r = await get("/tts/generated/" + encodeURIComponent("../evil.wav"));
  ok(r.status === 403, "非法生成文件名返回 403");
  // 教程图片：白名单内可访问，白名单外拒绝
  r = await get("/tts/tutorial/image1.png");
  ok(r.status === 200 && (r.headers["content-type"] || "").startsWith("image/"), "教程图片 image1.png 可访问");
  r = await get("/tts/tutorial/secret.txt");
  ok(r.status === 403, "非白名单教程文件返回 403");
} finally {
  // 清理：删除测试上传残留 + 恢复 config.json / manifest
  try { unlinkSync(join(SOUNDS_DIR, TEST_SOUND)); } catch { /* 已清理 */ }
  try { unlinkSync(join(SOUNDS_DIR, "__rename-a.wav")); } catch { /* 已清理 */ }
  try { unlinkSync(join(SOUNDS_DIR, "__rename-b.wav")); } catch { /* 已清理 */ }
  try { unlinkSync(join(SOUNDS_DIR, "__rename-c.wav")); } catch { /* 已清理 */ }
  try { unlinkSync(join(SOUNDS_DIR, "__manual.wav")); } catch { /* 已清理 */ }
  try { unlinkSync(join(GENERATED_DIR, TEST_GEN)); } catch { /* 已清理 */ }
  if (hadManifest) writeFileSync(MANIFEST_FILE, manifestBackup, "utf8");
  else try { unlinkSync(MANIFEST_FILE); } catch { /* 原本不存在 */ }
  if (hadConfig) writeFileSync(CONFIG_FILE, configBackup, "utf8");
  else try { unlinkSync(CONFIG_FILE); } catch { /* 原本不存在 */ }
  await new Promise((r) => server.close(r));
}

console.log(failures === 0 ? "ALL HOST TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
