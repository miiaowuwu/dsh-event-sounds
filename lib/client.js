/**
 * dsh-event-sounds 浏览器端（Client 半）v3 —— 深海女仆工坊（鲸鱼娘）风格。
 *
 * - 可拖动圆形悬浮按钮（拖到屏幕边缘自动缩成「只有 > 图标」的小半球；点击打开配置）
 * - 配置弹窗：可拖动（标题栏）、置顶；配置项详细：
 *   · 每个触发条件（会话结束 / 弹出选项 / 请求许可 / 停止）独立「启用勾选 + 音效下拉选择」；
 *     下拉含「内置提示音 / 不播放 / 具体音效」三种选择
 *   · 音量滑杆；测试区：「测试音效」下拉（含「内置提示音」选项）+ ▶ 播放 + 状态栏
 *   · 音效库列表（插件 sounds/ 文件夹的本地音频，宿主 /dsh-sounds-control 提供）+ 刷新
 *   · 重置按钮位置
 * - 音效来源 = 插件包 sounds/ 文件夹；未选择/加载失败时 Web Audio 内置提示音兜底
 * - 触发监测：conversation.input.dock 会话快照（pending 交互 + running 状态）
 */
window.__ModuleLoader__.load({
	id: "dsh-client-ui-event-sounds",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		// ==================== 常量 ====================
		const CFG_KEY = "dsh.soundsControl.v1";
		const UI_KEY = "dsh.soundsControl.ui.v2";
		const SOUNDS_BASE = "/dsh-sounds-control";
		const ROUND = 56;
		const DOCK_W = 26;
		const DOCK_H = 48;
		const KIND_MAP = { end: "会话结束", question: "弹出选项", approval: "请求许可", stop: "停止" };
		// 注意类事件（需要人介入）：弹出选项 / 请求许可 —— 出现即响铃，不受 running / 会话查看状态限制（始终响铃）
		// 完成类事件（end / stop）：仅回合结束且无新注意类时才判定
		const ATTENTION_KINDS = { question: true, approval: true };
		// 自定义音效支持的格式（与宿主端 MIME 表一致），单文件上限 20MB
		const UPLOAD_EXT = [".mp3", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".flac", ".wma", ".webm"];
		const MAX_UPLOAD_MB = 20;
		// 附带音效：不可真删，只能隐藏（软删），随时可恢复
		const BUILTIN_SOUNDS = ["「hirari do～」.mp3", "呢？.mp3"];
		const HIDDEN_KEY = "dsh.soundsControl.hidden.v1";
		// 音效取值的特殊语义：
		//  ""（内置提示音，置空）—— 播放 Web Audio 琶音（不依赖音频文件）
		//  NONE_SENTINEL（不播放）—— 该条件不播放任何音效
		//  DEFAULT_SENTINEL —— 测试音效下拉里的「内置提示音」选项，等价于触发条件的内置提示音
		const DEFAULT_SENTINEL = "__default__";
		const NONE_SENTINEL = "__none__";
		// 音效库音频的播放音量系数（相对音量滑杆）：mp3 响度通常明显高于内置提示音，
		// 统一打折播放，使两者听感接近
		const SOUND_VOLUME_SCALE = 0.6;

		function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

		// ==================== 配置（localStorage + 宿主 config.json）====================
		const DEFAULTS = {
			title: "安洁莉娜语音", // 配置弹窗标题的语音名字（可修改）
			volume: 0.75,
			style: "maid", // maid（鲸鱼娘，默认）| white（纯白）| black（纯黑）
			triggers: {
				// 默认：会话结束→「hirari do～」；弹出选项/请求许可→「呢？」；停止→内置提示音（sound 置空 ""）
				end: { on: true, sound: "「hirari do～」.mp3" },
				question: { on: true, sound: "呢？.mp3" },
				approval: { on: true, sound: "呢？.mp3" },
				stop: { on: true, sound: "" },
			},
			testSound: "",
		};
		// 逐字段清洗配置：类型校验 + 范围钳制 + 枚举过滤，坏字段回退默认值，
		// 防止旧版本 / 手改 localStorage / 宿主 config.json 的脏数据污染配置
		const STYLES = ["maid", "white", "black"];
		function sanitizeConfig(raw) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
			const volume = typeof raw.volume === "number" && isFinite(raw.volume) ? clamp(raw.volume, 0, 1) : DEFAULTS.volume;
			const triggers = {};
			Object.keys(DEFAULTS.triggers).forEach((k) => {
				const t = raw.triggers && raw.triggers[k] && typeof raw.triggers[k] === "object" ? raw.triggers[k] : null;
				const def = DEFAULTS.triggers[k];
				triggers[k] = {
					on: t ? t.on !== false : def.on,
					sound: t && typeof t.sound === "string" ? t.sound : def.sound,
				};
			});
			return {
				title: typeof raw.title === "string" ? raw.title.slice(0, 20) : DEFAULTS.title,
				volume: volume,
				style: STYLES.includes(raw.style) ? raw.style : DEFAULTS.style,
				triggers: triggers,
				testSound: typeof raw.testSound === "string" ? raw.testSound : DEFAULTS.testSound,
			};
		}
		function loadCfg() {
			try {
				const rawStr = window.localStorage.getItem(CFG_KEY);
				if (rawStr) {
					const parsed = JSON.parse(rawStr);
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						// 迁移旧版（单一 activeSound + 布尔开关）
						if (!parsed.triggers && typeof parsed.activeSound === "string") {
							return sanitizeConfig({
								title: parsed.title,
								volume: parsed.volume,
								style: parsed.style,
								triggers: {
									end: { on: parsed.onTurnEnd !== false, sound: parsed.activeSound },
									question: { on: parsed.onQuestion !== false, sound: parsed.activeSound },
									approval: { on: parsed.onApproval !== false, sound: parsed.activeSound },
									stop: { on: true, sound: parsed.activeSound },
								},
								testSound: parsed.activeSound,
							});
						}
						return sanitizeConfig(parsed);
					}
				}
			} catch (err) { /* ignore */ }
			return sanitizeConfig(null);
		}
		let config = loadCfg();

		// 宿主端配置持久化（config.json）：localStorage 被清空/换环境也不丢
		let pushTimer = null;
		let userModified = false; // 本会话是否已修改过配置（防止启动拉取远端时覆盖用户编辑）
		function pushHostConfig() {
			if (pushTimer) window.clearTimeout(pushTimer);
			pushTimer = window.setTimeout(() => {
				try {
					window.fetch(window.location.origin + SOUNDS_BASE + "/config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(config),
					}).catch(() => { /* ignore */ });
				} catch (err) { /* ignore */ }
			}, 300);
		}
		function loadHostConfig() {
			return window.fetch(window.location.origin + SOUNDS_BASE + "/config", { cache: "no-store" })
				.then((res) => (res.ok ? res.json() : null))
				.then((remote) => {
					if (remote && typeof remote === "object" && remote.triggers && !userModified) {
						config = sanitizeConfig(remote);
						try { window.localStorage.setItem(CFG_KEY, JSON.stringify(config)); } catch (err) { /* ignore */ }
					}
					return config;
				})
				.catch(() => config);
		}

		function saveCfg(patch) {
			userModified = true;
			config = Object.assign({}, config, patch);
			try { window.localStorage.setItem(CFG_KEY, JSON.stringify(config)); } catch (err) { /* ignore */ }
			pushHostConfig();
		}
		function setTrigger(kind, patch) {
			saveCfg({
				triggers: Object.assign({}, config.triggers, {
					[kind]: Object.assign({}, config.triggers[kind], patch),
				}),
			});
		}

		// ==================== UI 几何（按钮/弹窗位置）====================
		// 默认靠左；v2 键强制旧会话也采用新默认位置
		const UI_DEFAULTS = { cx: -1, cy: -1, docked: "left", popupX: -1, popupY: -1, popupOpen: false };
		function loadUi() {
			try {
				const raw = window.localStorage.getItem(UI_KEY);
				if (raw) return Object.assign({}, UI_DEFAULTS, JSON.parse(raw));
			} catch (err) { /* ignore */ }
			return Object.assign({}, UI_DEFAULTS);
		}
		let ui = loadUi();
		function saveUi(patch) {
			ui = Object.assign({}, ui, patch);
			try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (err) { /* ignore */ }
		}

		// ==================== 音效列表（宿主 /dsh-sounds-control/list）====================
		// 被隐藏（软删）的音效名：附带音效只隐藏不删文件，可随时恢复
		let hiddenSounds = (function () {
			try {
				const raw = window.localStorage.getItem(HIDDEN_KEY);
				if (raw) {
					const arr = JSON.parse(raw);
					if (Array.isArray(arr)) return arr.filter((n) => typeof n === "string");
				}
			} catch (err) { /* ignore */ }
			return [];
		})();
		function saveHidden() {
			try { window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenSounds)); } catch (err) { /* ignore */ }
		}
		function hideSound(name) {
			if (!hiddenSounds.includes(name)) { hiddenSounds.push(name); saveHidden(); }
		}
		function unhideSound(name) {
			hiddenSounds = hiddenSounds.filter((n) => n !== name);
			saveHidden();
		}

		let soundList = [];
		let soundListError = "";
		let soundListFailedAt = 0; // 失败时间戳：瞬时失败 30s 后允许自动重试
		async function refreshSounds() {
			try {
				const res = await window.fetch(window.location.origin + SOUNDS_BASE + "/list", { cache: "no-store" });
				if (!res.ok) throw new Error("HTTP " + res.status);
				const data = await res.json();
				soundList = Array.isArray(data.sounds)
					? data.sounds.filter((s) => !hiddenSounds.includes(s.name))
					: [];
				soundListError = "";
				soundListFailedAt = 0;
			} catch (err) {
				soundListError = String((err && err.message) || err);
				soundListFailedAt = Date.now();
			}
			return soundList;
		}
		function findSound(name) {
			return soundList.find((s) => s.name === name) || null;
		}

		// 真正删除音效文件（仅非附带音效；附带音效走 hideSound 软删）
		async function deleteSoundFile(name) {
			const res = await window.fetch(
				window.location.origin + SOUNDS_BASE + "/sounds/" + encodeURIComponent(name),
				{ method: "DELETE" }
			);
			if (!res.ok) throw new Error("HTTP " + res.status);
		}

		// 删除/隐藏音效后联动：引用它的触发条件与测试音效自动置空（避免播放失效）
		function clearSoundRefs(name) {
			const nextTrig = {};
			let trigChanged = false;
			Object.keys(config.triggers || {}).forEach((k) => {
				const t = config.triggers[k];
				if (t && t.sound === name) {
					nextTrig[k] = Object.assign({}, t, { sound: "" });
					trigChanged = true;
				}
			});
			if (trigChanged) saveCfg({ triggers: Object.assign({}, config.triggers, nextTrig) });
			if (config.testSound === name) saveCfg({ testSound: "" });
		}

		// 解析出需要预加载的具体音效名（内置提示音无需预加载；不播放→无）
		function resolveSoundName(sound) {
			if (sound === NONE_SENTINEL) return "";
			if (sound === DEFAULT_SENTINEL) sound = "";
			if (!sound) return "";
			return sound;
		}

		// 预加载/音频缓存：挂在 window 上，跨插件热重载存活，避免每次都重新加载 mp3
		function getCachedAudio(url) {
			const g = window.__scAudioCache || (window.__scAudioCache = new Map());
			let a = g.get(url);
			if (!a) {
				try {
					a = new window.Audio();
					a.preload = "auto";
					a.src = url;
					a.load();
					g.set(url, a);
				} catch (err) {
					return null;
				}
			}
			return a;
		}
		function preloadSound(name) {
			const s = findSound(name);
			if (!s) return;
			getCachedAudio(window.location.origin + s.url);
		}
		function preloadActiveSounds() {
			const names = [];
			Object.keys(KIND_MAP).forEach((k) => {
				const t = config.triggers && config.triggers[k];
				if (!t) return;
				const n = resolveSoundName(t.sound);
				if (n) names.push(n);
			});
			names.forEach(preloadSound);
		}

		// ==================== 播放状态（供弹窗显示）====================
		const statusListeners = new Set();
		let lastStatus = "就绪";
		function setStatus(text) {
			lastStatus = text;
			statusListeners.forEach((fn) => { try { fn(text); } catch (err) { /* ignore */ } });
		}

		// ==================== 内置提示音（Web Audio 兜底）====================
		let audioCtx = null;
		function getAudioCtx() {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return null;
			if (!audioCtx) {
				try { audioCtx = new AC(); } catch (err) { return null; }
			}
			if (audioCtx.state === "suspended") {
				try { audioCtx.resume(); } catch (err) { /* ignore */ }
			}
			return audioCtx;
		}
		function unlockAudio() {
			const c = audioCtx;
			if (!c || c.state !== "suspended") return;
			try { c.resume(); } catch (err) { /* ignore */ }
		}

		function playChime() {
			const c = getAudioCtx();
			if (!c) {
				setStatus("当前环境无任何音频能力（无 Web Audio）");
				return;
			}
			const vol = Math.min(1, Math.max(0, config.volume));
			const t0 = c.currentTime;
			// 多个正弦振荡的响度基准与本地 mp3 不同：单音峰值明显偏低，
			// 因此把增益放大到接近满音量音频文件的水平，避免提示音过于小声
			const master = c.createGain();
			master.gain.setValueAtTime(0.0001, t0);
			master.gain.exponentialRampToValueAtTime(Math.max(0.01, vol * 0.95), t0 + 0.02);
			master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.15);
			master.connect(c.destination);
			const notes = [523.25, 659.25, 783.99];
			notes.forEach((freq, i) => {
				const s = t0 + i * 0.09;
				const osc = c.createOscillator();
				osc.type = "sine";
				osc.frequency.setValueAtTime(freq, s);
				const g = c.createGain();
				g.gain.setValueAtTime(0.0001, s);
				g.gain.exponentialRampToValueAtTime(vol * 0.75, s + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
				osc.connect(g).connect(master);
				osc.start(s);
				osc.stop(s + 0.2);
			});
			const s2 = t0 + 0.3;
			const osc2 = c.createOscillator();
			osc2.type = "sine";
			osc2.frequency.setValueAtTime(1046.5, s2);
			osc2.frequency.linearRampToValueAtTime(1318.5, s2 + 0.25);
			const g2 = c.createGain();
			g2.gain.setValueAtTime(0.0001, s2);
			g2.gain.exponentialRampToValueAtTime(vol * 0.85, s2 + 0.03);
			g2.gain.exponentialRampToValueAtTime(0.0001, s2 + 0.7);
			osc2.connect(g2).connect(master);
			osc2.start(s2);
			osc2.stop(s2 + 0.75);
			setStatus("♪ 已播放（内置提示音）");
		}

		// ==================== 播放引擎（本地音频 -> 提示音兜底）====================
		let currentAudio = null;

		function playAudioUrl(url, label) {
			if (!url || typeof window.Audio !== "function") {
				setStatus("无音频源，播放内置提示音");
				playChime();
				return;
			}
			// 复用 window 级缓存中的 Audio 元素：已预加载/已播过的音效即点即播
			const audio = getCachedAudio(url);
			if (!audio) {
				setStatus("无法创建音频，播放内置提示音");
				playChime();
				return;
			}
			if (currentAudio && currentAudio !== audio) {
				try { currentAudio.pause(); } catch (err) { /* ignore */ }
			}
			let done = false;
			const finish = (fn) => { if (!done) { done = true; fn(); } };
			try {
				audio.volume = Math.min(1, Math.max(0, config.volume * SOUND_VOLUME_SCALE));
				audio.onerror = () => finish(() => {
					// 出错的缓存元素不可复用，移出缓存以便下次重建
					try { if (window.__scAudioCache) window.__scAudioCache.delete(url); } catch (err) { /* ignore */ }
					setStatus("音频加载失败（" + (label || "") + "），播放内置提示音");
					playChime();
				});
				const p = audio.play();
				if (p && typeof p.catch === "function") {
					p.catch(() => finish(() => { setStatus("播放被浏览器拦截，播放内置提示音"); playChime(); }));
				}
				currentAudio = audio;
				finish(() => setStatus("▶ 已播放：" + (label || "音效")));
			} catch (err) {
				finish(() => { setStatus("音频播放异常，播放内置提示音"); playChime(); });
			}
		}

		function playSoundName(name) {
			const s = findSound(name);
			if (!s) {
				setStatus("音效不存在：" + name + "（请刷新音效列表）");
				playChime();
				return;
			}
			playAudioUrl(window.location.origin + s.url, s.name);
		}

		// 按音效取值执行播放：
		//  "" / DEFAULT_SENTINEL（内置提示音）→ Web Audio 琶音
		//  NONE_SENTINEL（不播放）→ 无声
		//  具体音效名 → 播放音频文件
		function playByRef(sound) {
			if (sound === NONE_SENTINEL) return;
			if (sound === DEFAULT_SENTINEL) sound = "";
			if (!sound) { playChime(); return; } // 内置提示音
			// 列表为空：未失败过，或失败超过 30s（瞬时故障自动恢复重试）
			if (!soundList.length && (!soundListError || Date.now() - soundListFailedAt > 30000)) {
				refreshSounds().then(() => playSoundName(sound));
			} else {
				playSoundName(sound);
			}
		}

		// 触发播放：按触发条件各自的「启用 + 音效」配置（含 内置提示音 / 不播放 两种特殊取值）
		function play(kind) {
			const t = config.triggers && config.triggers[kind];
			if (!t || !t.on) return;
			playByRef(t.sound);
		}

		// 测试试听：播放「测试音效」下拉解析出的音效；
		// 选「内置提示音」或未指定具体音效时，播放 Web Audio 琶音
		function playTest() {
			playByRef(config.testSound);
		}

		// 判断当前回合是否为「非正常结束」：手动停止（interrupted）或异常终止
		// （turn-error / turn-max-tokens）—— 这些都应走「停止」音效
		function endedAbnormally(session) {
			const nodes = session.nodes || [];
			// 以最新节点的回合号作为当前回合边界，避免误判上一回合的报错
			let curTurn = -1;
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i];
				if (!n) continue;
				if (typeof n.turn === "number") { curTurn = n.turn; break; }
				if (n.data && typeof n.data.turn === "number") { curTurn = n.data.turn; break; }
			}
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i];
				if (!n) continue;
				const turn = typeof n.turn === "number" ? n.turn : (n.data && typeof n.data.turn === "number" ? n.data.turn : -1);
				if (turn !== -1 && turn < curTurn) break; // 已越过当前回合边界
				if (n.kind === "turn-error" || n.kind === "turn-max-tokens") return true;
				const data = n.data;
				if (n.kind === "assistant-step" || (data && data.kind === "assistant")) {
					return !!(data && (data.interrupted === true || data.status === "interrupted"));
				}
				// 跳过回合尾等非内容节点，继续向前找
			}
			return false;
		}

		// ==================== 常驻观察器（conversation.input.dock）====================
		function Watcher(props) {
			const session = props.session;
			// 每次渲染都把最新快照存入 ref：running 结束判定延迟执行时，能拿到
			// 已带上 interrupted / turn-error 标记的最新节点（这些标记晚一拍到达）
			const latestRef = React.useRef(session);
			latestRef.current = session;
			const prevRef = React.useRef(null);
			const endTimerRef = React.useRef(null);

			React.useEffect(() => {
				if (!session) return;
				const prev = prevRef.current;
				const pending = (session.pending || []).map((p) => String(p.kind) + ":" + String(p.key));
				const running = session.running === true;
				prevRef.current = { running: running, pending: pending };
				if (!prev) return;
				const seen = new Set(prev.pending);
				// 注意类检测：与 running 状态完全解耦 —— 会话正在运行/查看时新出现
				// question / approval 也照常响铃（始终响铃，不受当前会话限制）
				let newKind = null;
				for (let i = 0; i < pending.length; i++) {
					if (seen.has(pending[i])) continue;
					if (ATTENTION_KINDS[pending[i].slice(0, pending[i].indexOf(":"))]) newKind = pending[i].slice(0, pending[i].indexOf(":"));
				}
				if (newKind) {
					// 注意类优先：取消尚未执行的完成类结束判定，避免连响
					if (endTimerRef.current) {
						window.clearTimeout(endTimerRef.current);
						endTimerRef.current = null;
					}
					play(newKind);
				} else if (prev.running && !running) {
					// 完成类：仅回合 running 结束且无新注意类时判定——
					// 延迟 600ms 用最新快照判定；手动停止/异常终止的标记
					// （interrupted / turn-error / turn-max-tokens）可能晚一拍才落到节点上
					if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
					endTimerRef.current = window.setTimeout(() => {
						endTimerRef.current = null;
						play(endedAbnormally(latestRef.current) ? "stop" : "end");
					}, 600);
				}
			}, [session]);

			// 卸载时清理挂起的结束判定
			React.useEffect(() => () => {
				if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
			}, []);

			return null;
		}

		// ==================== UI 基础组件 ====================
		function Check(props) {
			return React.createElement("input", {
				type: "checkbox",
				checked: props.checked,
				onChange: (e) => props.onChange(e.target.checked),
			});
		}

		function Slider(props) {
			const fmt = props.format || ((v) => String(v));
			return React.createElement("div", { className: "sc-slider" },
				React.createElement("input", {
					type: "range",
					min: String(props.min),
					max: String(props.max),
					step: String(props.step),
					value: String(props.value),
					onChange: (e) => props.onChange(parseFloat(e.target.value)),
				}),
				React.createElement("span", { className: "sc-value" }, fmt(props.value)),
			);
		}

		function SoundSelect(props) {
			const options = [];
			// 触发条件用：「内置提示音」（Web Audio 琶音）与「不播放」（显式静音）
			if (props.allowDefault) {
				options.push(React.createElement("option", { value: "" }, "内置提示音"));
			} else if (props.placeholder) {
				// 测试音效选择器用：未选择任何音效时显示的提示
				options.push(React.createElement("option", { value: "" }, props.placeholder));
			}
			if (props.allowNone) options.push(React.createElement("option", { value: NONE_SENTINEL }, "不播放"));
			if (props.allowDefaultSentinel) options.push(React.createElement("option", { value: DEFAULT_SENTINEL }, "内置提示音"));
			options.push(props.sounds.map((s) => React.createElement("option", { value: s.name, key: s.name }, s.name)));
			return React.createElement("select", {
				className: "sc-select",
				value: props.value,
				title: props.title || "",
				onChange: (e) => props.onChange(e.target.value),
			}, ...options);
		}

		// ==================== 悬浮按钮（可拖动 / 靠边缩成半球）====================
		function buttonStyle(geo) {
			const d = geo.docked;
			const cx = geo.cx < 0 ? Math.round(window.innerWidth / 2) : geo.cx;
			const cy = geo.cy < 0 ? Math.round(window.innerHeight * 0.5) : geo.cy;
			const s = {};
			if (d === "right") {
				s.right = 0; s.top = Math.max(0, cy - DOCK_H / 2); s.width = DOCK_W; s.height = DOCK_H;
				s.borderRadius = DOCK_H / 2 + "px 0 0 " + DOCK_H / 2 + "px";
			} else if (d === "left") {
				s.left = 0; s.top = Math.max(0, cy - DOCK_H / 2); s.width = DOCK_W; s.height = DOCK_H;
				s.borderRadius = "0 " + DOCK_H / 2 + "px " + DOCK_H / 2 + "px 0";
			} else if (d === "top") {
				s.top = 0; s.left = Math.max(0, cx - DOCK_H / 2); s.width = DOCK_H; s.height = DOCK_W;
				s.borderRadius = "0 0 " + DOCK_H / 2 + "px " + DOCK_H / 2 + "px";
			} else if (d === "bottom") {
				s.bottom = 0; s.left = Math.max(0, cx - DOCK_H / 2); s.width = DOCK_H; s.height = DOCK_W;
				s.borderRadius = DOCK_H / 2 + "px " + DOCK_H / 2 + "px 0 0";
			} else {
				s.left = Math.max(0, cx - ROUND / 2); s.top = Math.max(0, cy - ROUND / 2);
				s.width = ROUND; s.height = ROUND; s.borderRadius = "50%";
			}
			return s;
		}

		function FloatingButton(props) {
			const geoRef = React.useRef(props.geo);
			React.useEffect(() => { geoRef.current = props.geo; }, [props.geo]);
			const dragRef = React.useRef(null);

			// 拖动：window 级监听（pointer capture 失败/移出窗口也不丢事件）
			const onPointerDown = (e) => {
				if (e.pointerType === "mouse" && e.button !== 0) return;
				e.preventDefault();
				const el = e.currentTarget;
				const g = geoRef.current;
				const st = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: g.cx, oy: g.cy, moved: false, active: true };
				dragRef.current = st;
				try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
				const cleanup = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onCancel);
					if (dragRef.current === st) dragRef.current = null;
				};
				const onMove = (ev) => {
					if (!st.active || ev.pointerId !== st.id) return;
					const dx = ev.clientX - st.sx, dy = ev.clientY - st.sy;
					if (Math.abs(dx) + Math.abs(dy) > 4) st.moved = true;
					const next = {
						cx: clamp(st.ox + dx, 30, Math.max(30, window.innerWidth - 30)),
						cy: clamp(st.oy + dy, 30, Math.max(30, window.innerHeight - 30)),
						docked: null,
					};
					geoRef.current = next;
					props.setGeo(next);
				};
				const onUp = (ev) => {
					if (!st.active || ev.pointerId !== st.id) return;
					st.active = false;
					try { el.releasePointerCapture(st.id); } catch (err) { /* ignore */ }
					if (!st.moved) {
						props.onToggle();
						cleanup();
						return;
					}
					const cx = clamp(st.ox + (ev.clientX - st.sx), 30, Math.max(30, window.innerWidth - 30));
					const cy = clamp(st.oy + (ev.clientY - st.sy), 30, Math.max(30, window.innerHeight - 30));
					let docked = null;
					if (cx <= 34) docked = "left";
					else if (cx >= window.innerWidth - 34) docked = "right";
					else if (cy <= 34) docked = "top";
					else if (cy >= window.innerHeight - 34) docked = "bottom";
					const next = { cx: cx, cy: cy, docked: docked };
					geoRef.current = next;
					props.setGeo(next);
					saveUi({ cx: cx, cy: cy, docked: docked });
					cleanup();
				};
				const onCancel = () => {
					if (!st.active) return;
					st.active = false;
					cleanup();
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onCancel);
			};

			const g = props.geo;
			const style = buttonStyle(g);
			const docked = !!g.docked;
			return React.createElement("button", {
				className: "sc-btn" + (docked ? " sc-docked" : ""),
				style: style,
				"data-sc-style": props.style || "maid",
				title: props.popupOpen ? "收起配置" : "打开" + (props.name || "安洁莉娜语音") + "配置",
				onPointerDown: onPointerDown,
			},
				docked
					? React.createElement("span", { className: "sc-btn-arrow" }, ">")
					: React.createElement("span", { className: "sc-btn-emoji" }, "🔊"),
			);
		}

		// ==================== 自定义音效弹窗（独立窗口：4:3 横版宽高比、可拖动、选择/拖拽上传）====================
		function CustomSoundModal(props) {
			const UPLOAD_W = 600; // 横版 4:3 → 高 = 600 * 3/4 = 450
			const [pos, setPos] = React.useState(() => ({
				x: Math.max(8, Math.round((window.innerWidth - UPLOAD_W) / 2)),
				y: Math.max(8, Math.round((window.innerHeight - UPLOAD_W * 3 / 4) / 2)),
			}));
			const posRef = React.useRef(pos);
			const headDragRef = React.useRef(null);
			const [dragOver, setDragOver] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [msg, setMsg] = React.useState({ kind: "idle", text: "" }); // idle | ok | err
			const [hidden, setHidden] = React.useState(hiddenSounds.slice());
			const inputRef = React.useRef(null);

			const pickFile = () => { if (inputRef.current) inputRef.current.click(); };

			// 恢复被隐藏（软删）的音效：移出隐藏列表并刷新音效库
			const restoreSound = (name) => {
				unhideSound(name);
				setHidden(hiddenSounds.slice());
				if (props.onUploaded) props.onUploaded(name);
			};

			const upload = async (file) => {
				if (!file || busy) return;
				const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
				if (!UPLOAD_EXT.includes(ext)) {
					setMsg({ kind: "err", text: "不支持的格式：" + (ext || "未知") + "（支持 " + UPLOAD_EXT.join(" / ") + "）" });
					return;
				}
				if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
					setMsg({ kind: "err", text: "文件过大：" + (file.size / 1024 / 1024).toFixed(1) + "MB（上限 " + MAX_UPLOAD_MB + "MB）" });
					return;
				}
				setBusy(true);
				setMsg({ kind: "idle", text: "上传中：" + file.name + "…" });
				try {
					const res = await window.fetch(
						window.location.origin + SOUNDS_BASE + "/sounds/upload?name=" + encodeURIComponent(file.name),
						{ method: "POST", body: file }
					);
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
					setMsg({ kind: "ok", text: "已添加：" + file.name });
					if (props.onUploaded) props.onUploaded(file.name);
				} catch (err) {
					setMsg({ kind: "err", text: "上传失败：" + String((err && err.message) || err) });
				} finally {
					setBusy(false);
				}
			};

			// 标题栏拖动（与配置弹窗一致：window 级监听不丢事件）
			const onHeadDown = (e) => {
				if (e.target.closest && e.target.closest("button")) return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				e.preventDefault();
				const el = e.currentTarget;
				const st = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: posRef.current.x, oy: posRef.current.y, active: true };
				headDragRef.current = st;
				try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
				const cleanup = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onCancel);
					if (headDragRef.current === st) headDragRef.current = null;
				};
				const onMove = (ev) => {
					if (!st.active || ev.pointerId !== st.id) return;
					const x = clamp(st.ox + (ev.clientX - st.sx), 0, Math.max(0, window.innerWidth - 80));
					const y = clamp(st.oy + (ev.clientY - st.sy), 0, Math.max(0, window.innerHeight - 60));
					posRef.current = { x: x, y: y };
					setPos({ x: x, y: y });
				};
				const onUp = (ev) => {
					if (!st.active || ev.pointerId !== st.id) return;
					st.active = false;
					try { el.releasePointerCapture(st.id); } catch (err) { /* ignore */ }
					cleanup();
				};
				const onCancel = () => {
					if (!st.active) return;
					st.active = false;
					cleanup();
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onCancel);
			};

			return React.createElement("div", { className: "sc-upload-popup", style: { left: pos.x, top: pos.y } },
				React.createElement("div", { className: "sc-upload-head", onPointerDown: onHeadDown },
					React.createElement("span", { className: "sc-popup-title" }, "🎵 自定义音效"),
					React.createElement("span", { className: "sc-popup-drag-hint" }, "按住拖动"),
					React.createElement("button", { className: "sc-head-btn", title: "关闭", onClick: props.onClose }, "×"),
				),
				React.createElement("div", { className: "sc-upload-body" },
					React.createElement("div", { className: "sc-hint sc-wiki-tip" },
						"💡 也可前往 Wiki 自行下载音频自用（如 明日方舟 ",
						React.createElement("a", { href: "https://prts.wiki/", target: "_blank", rel: "noreferrer" }, "https://prts.wiki/"),
						"），下载后通过下方区域导入即可。",
					),
					React.createElement("div", { className: "sc-hint" },
						"选择本地音频文件或拖拽到下方区域，将复制进插件 sounds/ 文件夹并出现在音效库。支持格式：" + UPLOAD_EXT.join(" / ") + "，单文件 ≤ " + MAX_UPLOAD_MB + "MB。"),
					React.createElement("div", {
						className: "sc-dropzone" + (dragOver ? " sc-dropzone-over" : ""),
						onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragOver(true); },
						onDragLeave: (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); },
						onDrop: (e) => {
							e.preventDefault(); e.stopPropagation(); setDragOver(false);
							const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
							if (f) upload(f);
						},
						onClick: () => { if (!busy) pickFile(); },
					},
						React.createElement("div", { className: "sc-dropzone-icon" }, "🎵"),
						React.createElement("div", { className: "sc-dropzone-text" }, busy ? "上传中…" : "点击选择文件，或将音频文件拖到此处"),
						React.createElement("div", { className: "sc-dropzone-sub" }, "mp3 / wav / ogg / m4a / flac / aac / webm 等"),
					),
					React.createElement("input", {
						ref: inputRef,
						type: "file",
						accept: "audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.wma,.webm",
						style: { display: "none" },
						onChange: (e) => {
							const f = e.target.files && e.target.files[0];
							e.target.value = "";
							if (f) upload(f);
						},
					}),
					msg.text ? React.createElement("div", { className: "sc-upload-msg sc-upload-msg-" + msg.kind }, msg.text) : null,
					// 已隐藏（软删）的附带音效：随时恢复展示
					hidden.length > 0 ? React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title" }, "已隐藏音效（附带音效，随时可恢复）"),
						hidden.map((n) => React.createElement("div", { className: "sc-sound-row", key: n },
							React.createElement("span", { className: "sc-sound-name", title: n }, n),
							React.createElement("span", { className: "sc-sound-kind" }, (n.split(".").pop() || "").toUpperCase()),
							React.createElement("button", { className: "sc-btn-ghost sc-btn-small", onClick: () => restoreSound(n) }, "恢复"),
						)),
					) : null,
					React.createElement("div", { className: "sc-upload-actions" },
						React.createElement("button", { className: "sc-btn-primary", disabled: busy, onClick: pickFile }, "选择文件"),
						React.createElement("button", { className: "sc-btn-ghost", onClick: props.onClose }, "关闭"),
					),
				),
			);
		}

		// ==================== 配置弹窗（可拖动 / 置顶 / 详细配置项）====================
		function ConfigPopup(props) {
			const [cfg, setCfg] = React.useState(Object.assign({}, config));
			const [pos, setPos] = React.useState({ x: ui.popupX, y: ui.popupY });
			const posRef = React.useRef(pos);
			const [sounds, setSounds] = React.useState(soundList.slice());
			const [loading, setLoading] = React.useState(false);
			const [showUpload, setShowUpload] = React.useState(false);
			const [refreshMsg, setRefreshMsg] = React.useState(""); // 刷新结果提示（显示在「重置按钮位置」旁）
			const [err, setErr] = React.useState(soundListError);
			const [status, setStatusState] = React.useState(lastStatus);
			const headDragRef = React.useRef(null);

			React.useEffect(() => {
				const fn = (t) => setStatusState(t);
				statusListeners.add(fn);
				return () => { statusListeners.delete(fn); };
			}, []);

			React.useEffect(() => {
				if (pos.x < 0 || pos.y < 0) {
					const x = Math.max(8, Math.round((window.innerWidth - 330) / 2));
					const y = Math.max(8, Math.round((window.innerHeight - 580) / 2));
					setPos({ x: x, y: y });
					posRef.current = { x: x, y: y };
					saveUi({ popupX: x, popupY: y });
				}
				doRefresh();
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, []);

			// 已保存提示（每次修改配置自动保存到 localStorage）
			const [saved, setSavedState] = React.useState(false);
			const savedTimerRef = React.useRef(null);
			const markSaved = () => {
				setSavedState(true);
				if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
				savedTimerRef.current = window.setTimeout(() => setSavedState(false), 1200);
			};

			const set = (patch) => {
				const next = Object.assign({}, cfg, patch);
				setCfg(next);
				saveCfg(patch);
				markSaved();
			};
			const setTrig = (kind, patch) => {
				const next = Object.assign({}, cfg, {
					triggers: Object.assign({}, cfg.triggers, {
						[kind]: Object.assign({}, cfg.triggers[kind], patch),
					}),
				});
				setCfg(next);
				setTrigger(kind, patch);
				markSaved();
			};
			const doRefresh = async () => {
				setLoading(true);
				await refreshSounds();
				// 打开弹窗时同时从宿主端拉一次配置，确保显示最新持久化值
				await loadHostConfig();
				setCfg(Object.assign({}, config));
				setSounds(soundList.slice());
				setErr(soundListError);
				setRefreshMsg(soundListError ? "音效读取失败" : "已刷新：" + soundList.length + " 个音效");
				setLoading(false);
				preloadActiveSounds();
			};

			// 删除音效：附带音效软删（隐藏，可恢复），其余真删文件；引用它的触发条件自动置空
			const doDelete = async (name) => {
				const isBuiltin = BUILTIN_SOUNDS.includes(name);
				if (isBuiltin) {
					hideSound(name);
				} else {
					try {
						await deleteSoundFile(name);
					} catch (err) {
						setErr("删除失败：" + String((err && err.message) || err));
						return;
					}
				}
				clearSoundRefs(name);
				setCfg(Object.assign({}, config)); // 触发条件可能被置空，同步界面
				doRefresh();
			};

			// 标题栏拖动：按住标题栏任意非按钮区域即可拖；window 级监听不丢事件
			const onHeadDown = (e) => {
				if (e.target.closest && e.target.closest("button")) return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				e.preventDefault();
				const el = e.currentTarget;
				const st = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: posRef.current.x, oy: posRef.current.y, active: true };
				headDragRef.current = st;
				try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
				const cleanup = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onCancel);
					if (headDragRef.current === st) headDragRef.current = null;
				};
				const onMove = (ev) => {
					if (!st.active || ev.pointerId !== st.id) return;
					const x = clamp(st.ox + (ev.clientX - st.sx), 0, Math.max(0, window.innerWidth - 80));
					const y = clamp(st.oy + (ev.clientY - st.sy), 0, Math.max(0, window.innerHeight - 60));
					posRef.current = { x: x, y: y };
					setPos({ x: x, y: y });
				};
				const onUp = (ev) => {
					if (!st.active || ev.pointerId !== st.id) return;
					st.active = false;
					try { el.releasePointerCapture(st.id); } catch (err) { /* ignore */ }
					saveUi({ popupX: posRef.current.x, popupY: posRef.current.y });
					cleanup();
				};
				const onCancel = () => {
					if (!st.active) return;
					st.active = false;
					cleanup();
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onCancel);
			};

			const px = pos.x < 0 ? Math.max(8, Math.round((window.innerWidth - 330) / 2)) : pos.x;
			const py = pos.y < 0 ? Math.max(8, Math.round((window.innerHeight - 580) / 2)) : pos.y;

			const soundOptions = sounds.map((s) => React.createElement("option", { value: s.name, key: s.name }, s.name));
			const triggerRows = Object.keys(KIND_MAP).map((kind) =>
				React.createElement("div", { className: "sc-trigger-row", key: kind },
					React.createElement(Check, {
						checked: !!(cfg.triggers[kind] && cfg.triggers[kind].on),
						onChange: (v) => setTrig(kind, { on: v }),
					}),
					React.createElement("span", { className: "sc-trigger-name" }, KIND_MAP[kind]),
					React.createElement(SoundSelect, {
						value: (cfg.triggers[kind] && cfg.triggers[kind].sound) || "",
						sounds: sounds,
						allowDefault: true,
						allowNone: true,
						onChange: (v) => { setTrig(kind, { sound: v }); preloadSound(resolveSoundName(v)); },
					}),
				)
			);

			return React.createElement(React.Fragment, null,
				React.createElement("div", { className: "sc-popup", "data-sc-style": props.style || "maid", style: { left: px, top: py } },
				React.createElement("div", {
					className: "sc-popup-head",
					onPointerDown: onHeadDown,
				},
					React.createElement("span", { className: "sc-popup-title" }, "🔊 " + (cfg.title || "安洁莉娜语音")),
					saved ? React.createElement("span", { className: "sc-saved" }, "✓ 已保存") : null,
					React.createElement("span", { className: "sc-popup-drag-hint" }, "按住拖动"),
					React.createElement("button", { className: "sc-head-btn", title: "刷新音效列表", onPointerDown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); doRefresh(); } }, "⟳"),
					React.createElement("button", { className: "sc-head-btn", title: "关闭", onPointerDown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); props.onClose(); } }, "×"),
				),
				React.createElement("div", { className: "sc-popup-body" },
					// 触发条件 → 音效
					React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title" }, "触发条件 · 音效"),
						triggerRows,
					),
					// 外观
					React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title" }, "外观"),
						React.createElement("div", { className: "sc-row" },
							React.createElement("span", { className: "sc-label" }, "风格"),
							React.createElement("select", {
								className: "sc-select",
								value: props.style || "maid",
								onChange: (e) => { props.onStyleChange(e.target.value); markSaved(); },
							},
								React.createElement("option", { value: "maid" }, "鲸鱼娘（默认）"),
								React.createElement("option", { value: "white" }, "纯白"),
								React.createElement("option", { value: "black" }, "纯黑"),
							),
						),
						React.createElement("div", { className: "sc-row" },
							React.createElement("span", { className: "sc-label" }, "语音名字"),
							React.createElement("input", {
								className: "sc-text-input",
								type: "text",
								value: cfg.title || "",
								placeholder: "安洁莉娜语音",
								maxLength: 20,
								title: "弹窗标题的语音名字，可自定义",
								onChange: (e) => set({ title: e.target.value }),
							}),
						),
					),
					// 音量
					React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title" }, "音量"),
						React.createElement("div", { className: "sc-row" },
							React.createElement("span", { className: "sc-label" }, "音量"),
							React.createElement(Slider, {
								value: cfg.volume, min: 0, max: 1, step: 0.05,
								format: (v) => Math.round(v * 100) + "%",
								onChange: (v) => set({ volume: v }),
							}),
						),
					),
					// 测试音效（含「内置提示音」选项：触发条件选「内置提示音」时播放 Web Audio 琶音）
					React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title" }, "测试音效"),
						React.createElement("div", { className: "sc-row sc-test-row" },
							React.createElement(SoundSelect, {
								value: cfg.testSound || "",
								sounds: sounds,
								allowDefaultSentinel: true,
								placeholder: "选择音效",
								title: "试听所选音效；选「内置提示音」或未指定时播放 Web Audio 琶音",
								onChange: (v) => { set({ testSound: v }); preloadSound(resolveSoundName(v)); },
							}),
							React.createElement("button", { className: "sc-btn-primary", onClick: () => playTest() }, "▶ 播放"),
						),
						React.createElement("div", { className: "sc-row sc-actions" },
							React.createElement("button", { className: "sc-btn-ghost", onClick: props.onResetPos }, "重置按钮位置"),
							refreshMsg ? React.createElement("span", { className: "sc-refresh-msg" }, refreshMsg) : null,
						),
						React.createElement("div", { className: "sc-status" }, status),
					),
					// 音效库
					React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title sc-section-title-row" },
							React.createElement("span", null, "音效库（插件 sounds/ 文件夹）"),
							React.createElement("span", { className: "sc-section-actions" },
								React.createElement("button", { className: "sc-btn-ghost sc-btn-small", onClick: () => setShowUpload(true) }, "自定义"),
								React.createElement("button", { className: "sc-btn-ghost sc-btn-small", onClick: doRefresh }, loading ? "刷新中…" : "刷新"),
							),
						),
						err ? React.createElement("div", { className: "sc-error" }, "读取音效失败：" + err) : null,
						sounds.length === 0 && !loading ? React.createElement("div", { className: "sc-hint" },
							"未找到音效。请把 mp3 / wav / ogg / m4a 等音频文件放入插件文件夹的 sounds/ 目录，然后点「刷新」。"
						) : null,
						sounds.map((s) => React.createElement("div", { className: "sc-sound-row", key: s.name },
							React.createElement("span", { className: "sc-sound-name", title: s.name }, s.name),
							React.createElement("button", {
								className: "sc-btn-ghost sc-btn-small sc-sound-del",
								title: BUILTIN_SOUNDS.includes(s.name) ? "附带音效：不可删除，将隐藏（可在「自定义」弹窗中恢复）" : "删除该音效（引用它的触发条件将自动置空）",
								onClick: () => doDelete(s.name),
							}, "🗑"),
							React.createElement("span", { className: "sc-sound-kind" }, (s.name.split(".").pop() || "").toUpperCase()),
						)),
					),
				),
				),
				// 自定义音效上传弹窗：独立于配置弹窗的浮动窗口（3:4 宽高比，可自由拖动）
				showUpload ? React.createElement(CustomSoundModal, {
					onClose: () => setShowUpload(false),
					onUploaded: () => doRefresh(),
				}) : null,
			);
		}

		// ==================== 根组件（按钮 + 弹窗）====================
		function HirariRoot() {
			const [open, setOpen] = React.useState(ui.popupOpen);
			const [geo, setGeo] = React.useState({ cx: ui.cx, cy: ui.cy, docked: ui.docked });
			const [style, setStyle] = React.useState(config.style || "maid");
			const onStyleChange = (v) => {
				setStyle(v);
				saveCfg({ style: v });
			};
			const toggle = () => {
				const next = !open;
				setOpen(next);
				saveUi({ popupOpen: next });
			};
			const close = () => {
				setOpen(false);
				saveUi({ popupOpen: false });
			};
			const resetPos = () => {
				const next = { cx: -1, cy: -1, docked: "left" };
				setGeo(next);
				saveUi({ cx: -1, cy: -1, docked: "left" });
			};
			return React.createElement(React.Fragment, null,
				React.createElement(FloatingButton, { geo: geo, setGeo: setGeo, popupOpen: open, onToggle: toggle, style: style, name: config.title || "安洁莉娜语音" }),
				open ? React.createElement(ConfigPopup, { onClose: close, onResetPos: resetPos, style: style, onStyleChange: onStyleChange }) : null,
			);
		}

		// ==================== 样式（深海女仆工坊 / 鲸鱼娘风格，含高对比配色）====================
		const CSS_TEXT = [
			// 悬浮按钮：侧栏珠宝按钮同款 —— 金边 + 海军蓝渐变 + 内嵌金环
			".sc-btn { position: fixed; z-index: 2147483000; display: flex; align-items: center; justify-content: center; cursor: grab; user-select: none; touch-action: none; padding: 0; border: 1px solid rgba(225,191,124,0.76); background: linear-gradient(145deg, rgba(77,103,169,0.55), rgba(7,18,52,0.85)); color: #ebd29e; box-shadow: inset 0 0 0 2px rgba(5,15,45,0.76), 0 3px 9px rgba(1,7,24,0.28); }",
			".sc-btn:active { cursor: grabbing; }",
			".sc-btn-emoji { font-size: 24px; line-height: 1; filter: drop-shadow(0 1px 2px rgba(2,7,24,0.5)); }",
			".sc-btn-arrow { font-size: 16px; font-weight: 700; line-height: 1; }",
			// 配置弹窗：玻璃面板 + 金色描边 + 毛玻璃；弹窗内颜色用 --sc-* 变量统一控制（亮/暗双套）
			".sc-popup { --sc-text: #172347; --sc-text-2: #33486e; --sc-text-dim: #5c6b8c; --sc-accent: #8a6524; --sc-status-text: #17336b; --sc-panel-bg: rgba(250,252,255,0.92); position: fixed; z-index: 2147483647; width: 330px; max-height: 84vh; display: flex; flex-direction: column; background: var(--sc-panel-bg, rgba(248,250,255,0.92)); border: 1px solid rgba(190,153,82,0.78); border-radius: 14px; box-shadow: 0 18px 44px rgba(13,29,68,0.3); backdrop-filter: blur(16px) saturate(0.9); color: var(--sc-text); overflow: hidden; }",
			"body[data-ds-dark-theme] .sc-popup { --sc-text: #eef2fb; --sc-text-2: #c6d2ea; --sc-text-dim: #a3b1d2; --sc-accent: #e8cd96; --sc-status-text: #eef2fb; --sc-panel-bg: rgba(14,26,60,0.94); }",
			".sc-popup-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(197,164,104,0.5); background: linear-gradient(180deg, rgba(226,235,250,0.94), rgba(207,220,244,0.82)); cursor: move; user-select: none; touch-action: none; }",
			".sc-popup-title { flex: auto; font-family: Georgia, 'Times New Roman', serif; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; color: var(--sc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".sc-popup-drag-hint { flex: none; font-size: 11px; color: var(--sc-text-dim); }",
			".sc-saved { flex: none; font-size: 11px; font-weight: 600; color: #2f9e63; }",
			".sc-head-btn { flex: none; width: 26px; height: 26px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--sc-text-2); font-size: 15px; cursor: pointer; line-height: 1; }",
			".sc-head-btn:hover { border-color: rgba(225,191,124,0.56); color: #fff1cf; background: rgba(91,119,188,0.35); }",
			".sc-popup-body { flex: auto; overflow-y: auto; padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 12px; }",
			".sc-section { display: flex; flex-direction: column; gap: 6px; }",
			".sc-section-title { font-family: Georgia, 'Times New Roman', serif; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: var(--sc-accent); }",
			".sc-section-title-row { display: flex; align-items: center; justify-content: space-between; }",
			".sc-row { display: flex; align-items: center; gap: 8px; min-height: 26px; }",
			".sc-trigger-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }",
			".sc-trigger-name { flex: none; width: 64px; font-size: 13px; font-weight: 500; color: var(--sc-text); }",
			".sc-test-row { flex-wrap: wrap; }",
			".sc-label { flex: none; width: 64px; font-size: 13px; font-weight: 500; color: var(--sc-text); }",
			".sc-value { flex: none; width: 52px; text-align: right; font-size: 12px; color: var(--sc-text-dim); }",
			".sc-slider { display: flex; align-items: center; gap: 8px; flex: auto; min-width: 0; }",
			".sc-slider input[type=range] { flex: auto; min-width: 0; }",
			".sc-select { flex: auto; min-width: 0; font-size: 13px; padding: 4px 6px; border-radius: 8px; border: 1px solid rgba(190,153,82,0.6); background: var(--sc-panel-bg); color: var(--sc-text); }",
			".sc-actions { gap: 8px; flex-wrap: wrap; }",
			".sc-btn-primary { font-size: 13px; padding: 5px 12px; border-radius: 8px; border: 1px solid rgba(225,191,124,0.6); background: linear-gradient(145deg, #6679b8, #405a99); color: #f8f3e8; cursor: pointer; }",
			".sc-btn-primary:hover { filter: brightness(1.1); }",
			".sc-btn-ghost { font-size: 12px; padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(190,153,82,0.6); background: rgba(255,253,248,0.6); color: var(--sc-text-2); cursor: pointer; }",
			".sc-btn-ghost:hover { background: rgba(226,232,246,0.85); }",
			".sc-btn-small { padding: 2px 8px; font-size: 12px; }",
			".sc-status { font-size: 12px; font-weight: 500; color: var(--sc-status-text); line-height: 1.5; padding: 4px 8px; border-radius: 8px; background: rgba(197,164,104,0.22); border: 1px solid rgba(197,164,104,0.5); word-break: break-all; }",
			".sc-error { font-size: 12px; color: #b4542f; line-height: 1.5; }",
			".sc-hint { font-size: 12px; color: var(--sc-text-dim); line-height: 1.6; }",
			".sc-sound-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid rgba(190,153,82,0.42); border-radius: 8px; background: rgba(255,253,248,0.5); }",
			".sc-sound-name { flex: auto; min-width: 0; font-size: 13px; color: var(--sc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".sc-sound-kind { flex: none; font-size: 11px; color: var(--sc-text-dim); }",
			".sc-section-actions { flex: none; display: inline-flex; gap: 6px; }",
			".sc-text-input { flex: auto; min-width: 0; font-size: 13px; padding: 4px 6px; border-radius: 8px; border: 1px solid rgba(190,153,82,0.6); background: var(--sc-panel-bg); color: var(--sc-text); }",
			".sc-refresh-msg { flex: auto; min-width: 0; font-size: 12px; color: var(--sc-text-dim); text-align: right; }",
			// 自定义音效上传弹窗（独立浮动窗口：4:3 横版宽高比、可拖动；自带深蓝变量，不依赖 .sc-popup 继承）
			".sc-upload-popup { --sc-text: #e7ecf7; --sc-text-2: #bdc9e3; --sc-text-dim: #96a6c9; --sc-accent: #e2cfaa; --sc-status-text: #e7ecf7; --sc-panel-bg: rgba(13,25,59,0.96); position: fixed; z-index: 2147483647; width: 600px; max-width: calc(100vw - 24px); aspect-ratio: 4 / 3; max-height: 92vh; border-radius: 14px; border: 1px solid rgba(190,153,82,0.78); background: var(--sc-panel-bg); color: var(--sc-text); box-shadow: 0 18px 44px rgba(13,29,68,0.4); display: flex; flex-direction: column; overflow: hidden; }",
			".sc-upload-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(197,164,104,0.5); background: linear-gradient(180deg, rgba(16,34,75,0.94), rgba(7,19,51,0.92)); cursor: move; user-select: none; touch-action: none; }",
			".sc-upload-body { flex: auto; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px; }",
			".sc-upload-popup .sc-btn-ghost { background: rgba(28,44,84,0.6); color: #d6def1; }",
			".sc-dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; flex: 1 1 auto; min-height: 120px; padding: 22px 12px; border: 2px dashed rgba(190,153,82,0.6); border-radius: 12px; cursor: pointer; background: rgba(255,255,255,0.06); text-align: center; }",
			".sc-dropzone:hover { border-color: rgba(190,153,82,0.9); }",
			".sc-dropzone-over { border-color: #e2cfaa; background: rgba(226,207,170,0.25); }",
			".sc-dropzone-icon { font-size: 26px; line-height: 1; }",
			".sc-dropzone-text { font-size: 13px; color: var(--sc-text); }",
			".sc-dropzone-sub { font-size: 11px; color: var(--sc-text-dim); }",
			".sc-upload-msg { font-size: 12px; line-height: 1.5; padding: 6px 8px; border-radius: 8px; background: rgba(197,164,104,0.22); border: 1px solid rgba(197,164,104,0.5); color: var(--sc-status-text); word-break: break-all; }",
			".sc-upload-msg-ok { color: #2f9e63; border-color: rgba(47,158,99,0.5); background: rgba(47,158,99,0.12); }",
			".sc-upload-msg-err { color: #b4542f; border-color: rgba(180,84,47,0.5); background: rgba(180,84,47,0.12); }",
			".sc-upload-actions { display: flex; justify-content: flex-end; gap: 8px; }",
			".sc-wiki-tip a { color: #e2cfaa; text-decoration: underline; }",
			// 删除按钮：仅鼠标悬浮在该音效行时显示（触屏设备常显）
			".sc-sound-del { flex: none; opacity: 0; transition: opacity 0.15s; }",
			".sc-sound-row:hover .sc-sound-del { opacity: 1; }",
			"@media (hover: none) { .sc-sound-del { opacity: 1; } }",
			// 深色模式微调
			"body[data-ds-dark-theme] .sc-popup-head { background: linear-gradient(180deg, rgba(16,34,75,0.94), rgba(7,19,51,0.92)); }",
			"body[data-ds-dark-theme] .sc-popup-title { color: #f3e8cf; }",
			"body[data-ds-dark-theme] .sc-head-btn { color: #d6def1; }",
			"body[data-ds-dark-theme] .sc-btn-ghost { background: rgba(28,44,84,0.6); color: #d6def1; }",
			"body[data-ds-dark-theme] .sc-select { background: rgba(17,30,66,0.9); }",
			"body[data-ds-dark-theme] .sc-sound-row { background: rgba(18,36,77,0.6); }",
			"body[data-ds-dark-theme] .sc-error { color: #f3a28a; }",
			"body[data-ds-dark-theme] .sc-saved { color: #6fd69b; }",
			// ============ 鲸鱼娘主题（默认，深海军蓝，对齐 dsh-deep-whale 深海女仆工坊） ============
			// 不依赖宿主 body[data-ds-dark-theme]：在裸 npx @deepseek-ai/dsh web 上弹窗也是深海军蓝
			"body .sc-popup[data-sc-style='maid'] { --sc-text: #e7ecf7; --sc-text-2: #bdc9e3; --sc-text-dim: #96a6c9; --sc-accent: #e2cfaa; --sc-status-text: #e7ecf7; --sc-panel-bg: rgba(13,25,59,0.94); }",
			"body .sc-popup[data-sc-style='maid'] .sc-popup-head { background: linear-gradient(180deg, rgba(16,34,75,0.94), rgba(7,19,51,0.92)); }",
			"body .sc-popup[data-sc-style='maid'] .sc-popup-title { color: #f3e8cf; }",
			"body .sc-popup[data-sc-style='maid'] .sc-head-btn { color: #d6def1; }",
			"body .sc-popup[data-sc-style='maid'] .sc-btn-ghost { background: rgba(28,44,84,0.6); color: #d6def1; }",
			"body .sc-popup[data-sc-style='maid'] .sc-select { background: rgba(17,30,66,0.9); }",
			"body .sc-popup[data-sc-style='maid'] .sc-sound-row { background: rgba(18,36,77,0.6); }",
			"body .sc-popup[data-sc-style='maid'] .sc-error { color: #f3a28a; }",
			"body .sc-popup[data-sc-style='maid'] .sc-saved { color: #6fd69b; }",
			// ============ 纯白主题 ============
			"body .sc-popup[data-sc-style='white'] { --sc-text: #111827; --sc-text-2: #374151; --sc-text-dim: #6b7280; --sc-accent: #111827; --sc-status-text: #1f2937; --sc-panel-bg: #ffffff; background: #ffffff; border-color: #e5e7eb; box-shadow: 0 8px 30px rgba(0,0,0,0.14); backdrop-filter: none; color: #111827; }",
			"body .sc-popup[data-sc-style='white'] .sc-popup-head { background: #f9fafb; border-bottom-color: #e5e7eb; }",
			"body .sc-popup[data-sc-style='white'] .sc-popup-title { color: #111827; }",
			"body .sc-popup[data-sc-style='white'] .sc-status { background: #f1f5f9; border-color: #e2e8f0; }",
			"body .sc-popup[data-sc-style='white'] .sc-sound-row { background: #f9fafb; border-color: #e5e7eb; }",
			"body .sc-popup[data-sc-style='white'] .sc-btn-ghost { background: #ffffff; color: #374151; border-color: #d1d5db; }",
			"body .sc-popup[data-sc-style='white'] .sc-select { background: #ffffff; }",
			"body .sc-btn[data-sc-style='white'] { background: #ffffff; border-color: #e2e8f0; color: #334155; box-shadow: 0 2px 10px rgba(0,0,0,0.12); }",
			// ============ 纯黑主题 ============
			"body .sc-popup[data-sc-style='black'] { --sc-text: #f3f4f6; --sc-text-2: #d1d5db; --sc-text-dim: #9ca3af; --sc-accent: #e5e7eb; --sc-status-text: #f3f4f6; --sc-panel-bg: #111827; background: #111827; border-color: #374151; box-shadow: 0 10px 34px rgba(0,0,0,0.5); backdrop-filter: none; color: #f3f4f6; }",
			"body .sc-popup[data-sc-style='black'] .sc-popup-head { background: #1f2937; border-bottom-color: #374151; }",
			"body .sc-popup[data-sc-style='black'] .sc-popup-title { color: #f3f4f6; }",
			"body .sc-popup[data-sc-style='black'] .sc-head-btn { color: #d1d5db; }",
			"body .sc-popup[data-sc-style='black'] .sc-status { background: #1f2937; border-color: #4b5563; }",
			"body .sc-popup[data-sc-style='black'] .sc-sound-row { background: #1f2937; border-color: #374151; }",
			"body .sc-popup[data-sc-style='black'] .sc-sound-name { color: #f3f4f6; }",
			"body .sc-popup[data-sc-style='black'] .sc-btn-ghost { background: #1f2937; color: #d1d5db; border-color: #4b5563; }",
			"body .sc-popup[data-sc-style='black'] .sc-select { background: #1f2937; color: #f3f4f6; }",
			"body .sc-btn[data-sc-style='black'] { background: #111827; border-color: #374151; color: #e5e7eb; box-shadow: 0 2px 10px rgba(0,0,0,0.45); }",
		].join("\n");

		// ==================== 插件主体 ====================
		const inject = ["slots"];

		function apply(ctx) {
			// 打开软件即预加载：先拉宿主持久化配置（拿到真实音效映射），再拉音效列表，
			// 最后预加载配置的音效 —— 保证首次播放时音频已缓冲
			loadHostConfig()
				.then(() => refreshSounds())
				.then(() => preloadActiveSounds())
				.catch(() => { /* ignore */ });

			// 加载提示（3 秒后消失）：用于确认插件已在浏览器端生效
			ctx.effect(() => {
				const el = document.createElement("div");
				el.textContent = "dsh-event-sounds 已加载";
				el.setAttribute("data-plugin", "event-sounds-boot");
				Object.assign(el.style, {
					position: "fixed", top: "12px", right: "12px", zIndex: "2147483647",
					background: "rgba(16,185,129,0.94)", color: "#fff", padding: "6px 12px",
					borderRadius: "8px", fontSize: "13px", fontFamily: "sans-serif",
					pointerEvents: "none", boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
				});
				document.body.appendChild(el);
				const t = window.setTimeout(() => el.remove(), 3500);
				return () => { window.clearTimeout(t); el.remove(); };
			});

			// 注入样式（随插件生命周期增删；data-plugin 用模块 id，供 HMR 热重载时清理）
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.setAttribute("data-plugin", "dsh-client-ui-event-sounds");
				tag.textContent = CSS_TEXT;
				document.head.appendChild(tag);
				return () => { tag.remove(); };
			});

			// 首次用户交互解锁音频上下文（自动触发播放也能出声）
			ctx.effect(() => {
				window.addEventListener("pointerdown", unlockAudio);
				window.addEventListener("keydown", unlockAudio);
				return () => {
					window.removeEventListener("pointerdown", unlockAudio);
					window.removeEventListener("keydown", unlockAudio);
				};
			});

			const slots = ctx.get("slots");
			if (slots === undefined) return;

			// 悬浮按钮 + 配置弹窗（shell.overlay，置顶）
			// 注册各自 try/catch：热重载时单个槽位失败不拖垮整个插件
			try {
				slots.inject("shell.overlay", () => slots.register(
					{ name: "shell.overlay", id: "event-sounds-root", order: 60 },
					() => React.createElement(HirariRoot, null),
				));
			} catch (err) { /* ignore */ }

			// 常驻观察器：监测会话快照（回合结束 / 弹出选项 / 请求许可 / 停止）
			try {
				slots.inject("conversation.input.dock", () => slots.register(
					{ name: "conversation.input.dock", id: "event-sounds-watcher", order: 80 },
					(props) => React.createElement(Watcher, { session: props.session }),
				));
			} catch (err) { /* ignore */ }
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
