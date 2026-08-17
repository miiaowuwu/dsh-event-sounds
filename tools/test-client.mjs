// dsh-event-sounds 浏览器端（Client 半）逻辑冒烟测试（运行：node tools/test-client.mjs）
//
// 用 fake window（localStorage / fetch / AudioContext / Audio）+ fake React
// 在 Node 里执行 lib/client.js 的 factory，随后 apply(fakeCtx) 注册槽位，
// 通过渲染 conversation.input.dock 的 Watcher 组件驱动会话快照变化，
// 断言：配置逐字段清洗（sanitize）、注意类始终响铃、完成类判定、不播放、
// 默认音量与默认音效等行为。
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CFG_KEY = "dsh.soundsControl.v1";
const UI_KEY = "dsh.soundsControl.ui.v2";

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log("PASS", label);
  else { failures++; console.log("FAIL", label); }
};

function makeEnv({ configSeed, hostConfig, sounds = [] } = {}) {
  // ---- fake window ----
  const storage = new Map();
  if (configSeed !== undefined) storage.set(CFG_KEY, JSON.stringify(configSeed));
  storage.set(UI_KEY, JSON.stringify({ popupOpen: true }));
  const timers = [];
  let timerId = 0;
  const slotRegs = {};
  const disposers = [];
  let oscCount = 0;
  const gains = [];
  const audioPlays = [];
  const effects = [];
  let hooks = [];
  let hookIdx = 0;

  const fakeWindow = {
    __ModuleLoader__: { load: (entry) => { fakeWindow.__entry = entry; } },
    location: { origin: "http://test.local" },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
    },
    fetch: async (url) => {
      if (url.endsWith("/config")) {
        return { ok: true, json: async () => (hostConfig === undefined ? {} : hostConfig) };
      }
      if (url.endsWith("/list")) {
        return { ok: true, json: async () => ({ sounds, dir: "/sounds" }) };
      }
      return { ok: false, json: async () => ({}) };
    },
    AudioContext: class {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createOscillator() {
        oscCount++;
        return {
          type: "sine",
          frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
          connect: () => ({ connect: () => {} }),
          start() {}, stop() {},
        };
      }
      createGain() {
        const gain = { setValueAtTime() {}, exponentialRampToValueAtTime(v) { gains.push(v); } };
        return { gain, connect: () => ({ connect: () => {} }) };
      }
    },
    Audio: class {
      constructor() { this.volume = 0; }
      load() {}
      play() { audioPlays.push(this.src); return Promise.resolve(); }
    },
    document: {
      createElement: () => ({ setAttribute() {}, remove() {}, style: {}, textContent: "" }),
      body: { appendChild() {} },
      head: { appendChild() {} },
    },
    setTimeout: (fn, ms) => { timers.push({ id: ++timerId, fn, ms, cleared: false }); return timerId; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    addEventListener() {}, removeEventListener() {},
  };

  // ---- fake React ----
  const react = {
    createElement: (type, props, ...children) => {
      if (typeof type === "function") return type(props || {});
      return { type, props: props || {}, children };
    },
    useState: (init) => {
      if (hooks[hookIdx] === undefined) hooks[hookIdx] = { val: typeof init === "function" ? init() : init };
      return [hooks[hookIdx++].val, () => {}];
    },
    useRef: (init) => {
      if (hooks[hookIdx] === undefined) hooks[hookIdx] = { current: init };
      return hooks[hookIdx++];
    },
    useEffect: (fn) => { effects.push(fn); },
  };

  // 执行 client.js 模块，拿到 exports（apply / inject）
  // eslint-disable-next-line no-new-func
  new Function("window", "document", source + "\n")(fakeWindow, fakeWindow.document);
  const exportsObj = fakeWindow.__entry.factory((spec) => (spec === "react" ? react : undefined));

  // ---- fake ctx ----
  const slots = {
    inject: (name, cb) => { slotRegs[name] = cb(); },
    register: (opts, comp) => ({ opts, comp }),
  };
  const ctx = {
    get: (key) => (key === "slots" ? slots : undefined),
    effect: (fn) => { const d = fn(); if (typeof d === "function") disposers.push(d); },
  };

  // 渲染 Watcher 组件一次，并执行其副作用（模拟 React commit）
  const render = (session) => {
    hookIdx = 0;
    effects.length = 0;
    slotRegs["conversation.input.dock"].comp({ session });
    effects.forEach((fn) => fn());
  };

  return {
    exportsObj, ctx, slotRegs,
    render,
    flushTimers: () => timers.filter((t) => !t.cleared).forEach((t) => { t.cleared = true; t.fn(); }),
    getOsc: () => oscCount,
    gains, audioPlays,
    tick: () => new Promise((r) => setTimeout(r, 0)),
  };
}

// ---------- 场景 1：模块导出与槽位注册 ----------
{
  const env = makeEnv();
  ok(typeof env.exportsObj.apply === "function", "client 导出 apply");
  ok(Array.isArray(env.exportsObj.inject) && env.exportsObj.inject.includes("slots"), "client 导出 inject 包含 slots");
  env.exportsObj.apply(env.ctx);
  ok(!!env.slotRegs["shell.overlay"], "注册 shell.overlay 槽位");
  ok(!!env.slotRegs["conversation.input.dock"], "注册 conversation.input.dock 槽位");
}

// ---------- 场景 2：脏配置被 sanitize（类型/范围/枚举回退默认），默认 end 音效仍生效 ----------
{
  const env = makeEnv({
    configSeed: { volume: "loud", style: "blue", testSound: 42, triggers: { end: { on: "yes", sound: 42 }, question: null } },
    sounds: [{ name: "「hirari do～」.mp3", url: "/s/h.mp3" }],
  });
  let threw = false;
  try {
    env.exportsObj.apply(env.ctx);
    env.render({ running: true, pending: [] });
    env.render({ running: false, pending: [] });
    env.flushTimers();
  } catch (e) { threw = true; console.log(e); }
  ok(!threw, "脏配置不崩溃（sanitize 兜底）");
  await env.tick(); await env.tick();
  ok(env.audioPlays.length === 1 && env.audioPlays[0].endsWith("/s/h.mp3"), "end 默认音效「hirari do～」被播放（脏 sound 回退默认）");
}

// ---------- 场景 3：注意类（question）在 running 中也立即响铃（始终响铃） ----------
{
  const env = makeEnv({ configSeed: { triggers: { question: { on: true, sound: "" } } } });
  env.exportsObj.apply(env.ctx);
  const before = env.getOsc();
  env.render({ running: true, pending: [] });
  env.render({ running: true, pending: [{ kind: "question", key: "q1" }] });
  ok(env.getOsc() > before, "running 中新增 question 立即播放（注意类始终响铃）");
}

// ---------- 场景 4：注意类（approval）优先于完成类判定 ----------
{
  const env = makeEnv({ configSeed: { triggers: { approval: { on: true, sound: "" } } } });
  env.exportsObj.apply(env.ctx);
  const before = env.getOsc();
  env.render({ running: true, pending: [] });
  env.render({ running: false, pending: [{ kind: "approval", key: "a1" }] });
  ok(env.getOsc() > before, "running 结束时新 approval 照常播放（注意类不受结束判定抑制）");
}

// ---------- 场景 5：不播放（__none__）静音 ----------
{
  const env = makeEnv({ configSeed: { triggers: { stop: { on: true, sound: "__none__" } } } });
  env.exportsObj.apply(env.ctx);
  const before = env.getOsc();
  env.render({ running: true, pending: [] });
  env.render({ running: false, pending: [], nodes: [{ kind: "assistant-step", turn: 1, data: { interrupted: true } }] });
  env.flushTimers();
  ok(env.getOsc() === before, "stop 选择「不播放」时不产生任何声音");
}

// ---------- 场景 6：默认音量 75% 作用于内置提示音 ----------
{
  const env = makeEnv({ configSeed: { triggers: { question: { on: true, sound: "" } } } }); // volume 未设置 → 默认 0.75
  env.exportsObj.apply(env.ctx);
  env.render({ running: true, pending: [] });
  env.render({ running: true, pending: [{ kind: "question", key: "q1" }] });
  ok(env.gains.some((v) => Math.abs(v - 0.75 * 0.95) < 1e-9), "默认音量 0.75 作用于内置提示音（master 增益 = 0.75×0.95）");
}

// ---------- 场景 7：宿主端脏 config 被 sanitize 后回退默认 ----------
{
  const env = makeEnv({
    hostConfig: { volume: 99, style: "pink", triggers: { end: { on: true, sound: 123 } } },
    sounds: [{ name: "「hirari do～」.mp3", url: "/s/h.mp3" }],
  });
  env.exportsObj.apply(env.ctx);
  await env.tick(); await env.tick(); // 等待 loadHostConfig 完成
  env.render({ running: true, pending: [] });
  env.render({ running: false, pending: [] });
  env.flushTimers();
  await env.tick(); await env.tick();
  ok(env.audioPlays.length === 1 && env.audioPlays[0].endsWith("/s/h.mp3"), "宿主端脏配置 sanitize 后 end 回退默认音效");
}

console.log(failures === 0 ? "ALL CLIENT TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
