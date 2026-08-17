/**
 * dsh-event-sounds 浏览器端（Client 半）v3 —— 深海女仆工坊（鲸鱼娘）风格。
 *
 * - 可拖动圆形悬浮按钮（拖到屏幕边缘自动缩成「只有 > 图标」的小半球；点击打开配置）
 * - 配置弹窗：可拖动（标题栏）、置顶；配置项详细：
 *   · 每个触发条件（回合结束 / 弹出选项 / 请求许可）独立「启用勾选 + 音效下拉选择」
 *   · 音量滑杆；测试区：独立「测试音效」下拉 + ▶ 播放 + 状态栏
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

		function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

		// ==================== 配置（localStorage + 宿主 config.json）====================
		const DEFAULTS = {
			volume: 0.9,
			style: "maid", // maid（鲸鱼娘，默认）| white（纯白）| black（纯黑）
			triggers: {
				end: { on: true, sound: "" },
				question: { on: true, sound: "" },
				approval: { on: true, sound: "" },
				stop: { on: true, sound: "" },
			},
			testSound: "",
		};
		function loadCfg() {
			try {
				const raw = window.localStorage.getItem(CFG_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						// 迁移旧版（单一 activeSound + 布尔开关）
						if (!parsed.triggers && typeof parsed.activeSound === "string") {
							return {
								volume: typeof parsed.volume === "number" ? parsed.volume : 0.9,
								style: "maid",
								triggers: {
									end: { on: parsed.onTurnEnd !== false, sound: parsed.activeSound },
									question: { on: parsed.onQuestion !== false, sound: parsed.activeSound },
									approval: { on: parsed.onApproval !== false, sound: parsed.activeSound },
									stop: { on: true, sound: parsed.activeSound },
								},
								testSound: parsed.activeSound,
							};
						}
						return Object.assign({}, DEFAULTS, parsed, {
							triggers: Object.assign({}, DEFAULTS.triggers, parsed.triggers),
						});
					}
				}
			} catch (err) { /* ignore */ }
			return Object.assign({}, DEFAULTS);
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
						config = Object.assign({}, DEFAULTS, remote, {
							triggers: Object.assign({}, DEFAULTS.triggers, remote.triggers),
						});
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
		let soundList = [];
		let soundListError = "";
		let soundListFailedAt = 0; // 失败时间戳：瞬时失败 30s 后允许自动重试
		async function refreshSounds() {
			try {
				const res = await window.fetch(window.location.origin + SOUNDS_BASE + "/list", { cache: "no-store" });
				if (!res.ok) throw new Error("HTTP " + res.status);
				const data = await res.json();
				soundList = Array.isArray(data.sounds) ? data.sounds : [];
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
			if (config.testSound) names.push(config.testSound);
			Object.keys(KIND_MAP).forEach((k) => {
				const t = config.triggers && config.triggers[k];
				if (t && t.sound) names.push(t.sound);
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
			const master = c.createGain();
			master.gain.setValueAtTime(0.0001, t0);
			master.gain.exponentialRampToValueAtTime(Math.max(0.01, vol * 0.55), t0 + 0.02);
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
				g.gain.exponentialRampToValueAtTime(vol * 0.4, s + 0.02);
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
			g2.gain.exponentialRampToValueAtTime(vol * 0.5, s2 + 0.03);
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
				audio.volume = Math.min(1, Math.max(0, config.volume));
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

		// 触发播放：按触发条件各自的「启用 + 音效」配置
		function play(kind) {
			const t = config.triggers && config.triggers[kind];
			if (!t || !t.on || !t.sound) return;
			// 列表为空：未失败过，或失败超过 30s（瞬时故障自动恢复重试）
			if (!soundList.length && (!soundListError || Date.now() - soundListFailedAt > 30000)) {
				refreshSounds().then(() => playSoundName(t.sound));
			} else {
				playSoundName(t.sound);
			}
		}

		// 测试播放：用「测试音效」选择器指定的音效（缺省用第一个音效）
		function playTest() {
			const name = config.testSound || (soundList.length ? soundList[0].name : "");
			if (!name) {
				setStatus("没有可用音效（请把音频放入插件 sounds/ 文件夹后刷新）");
				playChime();
				return;
			}
			playSoundName(name);
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
				let newKind = null;
				for (let i = 0; i < pending.length; i++) {
					if (seen.has(pending[i])) continue;
					if (pending[i].indexOf("question:") === 0) newKind = "question";
					else if (pending[i].indexOf("approval:") === 0) newKind = "approval";
				}
				if (newKind) {
					// 选项/许可音效优先；取消尚未执行的结束判定，避免连响
					if (endTimerRef.current) {
						window.clearTimeout(endTimerRef.current);
						endTimerRef.current = null;
					}
					play(newKind);
				} else if (prev.running && !running) {
					// running 结束：延迟 600ms 用最新快照判定——
					// 手动停止/异常终止的标记（interrupted / turn-error / turn-max-tokens）可能晚一拍才落到节点上
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
			return React.createElement("select", {
				className: "sc-select",
				value: props.value,
				onChange: (e) => props.onChange(e.target.value),
			},
				React.createElement("option", { value: "" }, props.allowEmpty ? "（不播放）" : "（选择音效）"),
				props.sounds.map((s) => React.createElement("option", { value: s.name, key: s.name }, s.name)),
			);
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
				title: props.popupOpen ? "收起配置" : "打开安洁莉娜语音配置",
				onPointerDown: onPointerDown,
			},
				docked
					? React.createElement("span", { className: "sc-btn-arrow" }, ">")
					: React.createElement("span", { className: "sc-btn-emoji" }, "🔊"),
			);
		}

		// ==================== 配置弹窗（可拖动 / 置顶 / 详细配置项）====================
		function ConfigPopup(props) {
			const [cfg, setCfg] = React.useState(Object.assign({}, config));
			const [pos, setPos] = React.useState({ x: ui.popupX, y: ui.popupY });
			const posRef = React.useRef(pos);
			const [sounds, setSounds] = React.useState(soundList.slice());
			const [loading, setLoading] = React.useState(false);
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
				setStatus(soundListError ? "音效读取失败：" + soundListError : "已刷新：" + soundList.length + " 个音效");
				setLoading(false);
				preloadActiveSounds();
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
						allowEmpty: true,
						onChange: (v) => { setTrig(kind, { sound: v }); if (v) preloadSound(v); },
					}),
				)
			);

			return React.createElement("div", { className: "sc-popup", "data-sc-style": props.style || "maid", style: { left: px, top: py } },
				React.createElement("div", {
					className: "sc-popup-head",
					onPointerDown: onHeadDown,
				},
					React.createElement("span", { className: "sc-popup-title" }, "🔊 安洁莉娜语音"),
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
						React.createElement("div", { className: "sc-hint" }, "勾选启用，下拉选择该触发条件要播放的音效；留空则该触发条件不播放。「停止」包含手动停止与异常终止（报错/超限）。"),
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
					// 测试
					React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title" }, "播放测试"),
						React.createElement("div", { className: "sc-row sc-test-row" },
							React.createElement(SoundSelect, {
								value: cfg.testSound || "",
								sounds: sounds,
								allowEmpty: false,
								onChange: (v) => { set({ testSound: v }); if (v) preloadSound(v); },
							}),
							React.createElement("button", { className: "sc-btn-primary", onClick: () => playTest() }, "▶ 播放"),
						),
						React.createElement("div", { className: "sc-row sc-actions" },
							React.createElement("button", { className: "sc-btn-ghost", onClick: props.onResetPos }, "重置按钮位置"),
						),
						React.createElement("div", { className: "sc-status" }, status),
					),
					// 音效库
					React.createElement("div", { className: "sc-section" },
						React.createElement("div", { className: "sc-section-title sc-section-title-row" },
							React.createElement("span", null, "音效库（插件 sounds/ 文件夹）"),
							React.createElement("button", { className: "sc-btn-ghost sc-btn-small", onClick: doRefresh }, loading ? "刷新中…" : "刷新"),
						),
						err ? React.createElement("div", { className: "sc-error" }, "读取音效失败：" + err) : null,
						sounds.length === 0 && !loading ? React.createElement("div", { className: "sc-hint" },
							"未找到音效。请把 mp3 / wav / ogg / m4a 等音频文件放入插件文件夹的 sounds/ 目录，然后点「刷新」。"
						) : null,
						sounds.map((s) => React.createElement("div", { className: "sc-sound-row", key: s.name },
							React.createElement("span", { className: "sc-sound-name", title: s.name }, s.name),
							React.createElement("span", { className: "sc-sound-kind" }, (s.name.split(".").pop() || "").toUpperCase()),
						)),
					),
				),
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
				React.createElement(FloatingButton, { geo: geo, setGeo: setGeo, popupOpen: open, onToggle: toggle, style: style }),
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
			".sc-popup { --sc-text: #172347; --sc-text-2: #33486e; --sc-text-dim: #5c6b8c; --sc-accent: #8a6524; --sc-status-text: #17336b; --sc-panel-bg: rgba(250,252,255,0.92); position: fixed; z-index: 2147483647; width: 330px; max-height: 84vh; display: flex; flex-direction: column; background: var(--sc-panel-bg, rgba(248,250,255,0.92)); border: 1px solid rgba(190,153,82,0.78); border-radius: 14px; box-shadow: var(--maid-shadow, 0 18px 44px rgba(13,29,68,0.3)); backdrop-filter: blur(16px) saturate(0.9); color: var(--sc-text); overflow: hidden; }",
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
			// 深色模式微调
			"body[data-ds-dark-theme] .sc-popup-head { background: linear-gradient(180deg, rgba(16,34,75,0.94), rgba(7,19,51,0.92)); }",
			"body[data-ds-dark-theme] .sc-popup-title { color: #f3e8cf; }",
			"body[data-ds-dark-theme] .sc-head-btn { color: #d6def1; }",
			"body[data-ds-dark-theme] .sc-btn-ghost { background: rgba(28,44,84,0.6); color: #d6def1; }",
			"body[data-ds-dark-theme] .sc-select { background: rgba(17,30,66,0.9); }",
			"body[data-ds-dark-theme] .sc-sound-row { background: rgba(18,36,77,0.6); }",
			"body[data-ds-dark-theme] .sc-error { color: #f3a28a; }",
			"body[data-ds-dark-theme] .sc-saved { color: #6fd69b; }",
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
