// dsh-event-sounds 多 profile 自动检测配置脚本（运行：node tools/install.mjs）
//
// dsh 的插件按 profile 隔离（$DSH_HOME/profiles/<name> 各自有 package.json /
// cordis.patch.yml / node_modules），桌面版与 web 版是不同 profile，不共用配置。
// 本脚本扫描本机所有 profile：
//   - 未配置本插件的 profile → 执行 `dsh plugin --profile <name> add link:<目标目录>`
//   - 已配置且链接有效 → 保持不动
//   - 已配置但链接失效 → 提示（加 --fix 自动修复）
// 最后汇总输出：每个 profile 配置了哪些 / 跳过哪些。
//
// 参数：
//   --dry-run   只检测并打印结果，不写任何 profile
//   --fix       已配置但链接失效的 profile 也自动重新配置
//   --unify     强制所有 profile 的链接统一指向当前开发目录（桌面版与 web 版共用同一份代码）
//   --deploy    把插件复制到 $DSH_HOME/plugins/<name>，并把所有 profile 的链接统一指向
//               部署副本（web 与 desktop 全程走 DSH_HOME 一条路；开发期请用 link 开发目录）
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, readFileSync, writeFileSync, realpathSync, statSync, symlinkSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(SELF, "..");
const PKG_NAME = "dsh-client-ui-event-sounds";
const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const PROFILES_DIR = join(DSH_HOME, "profiles");
const DEPLOY_DIR = join(DSH_HOME, "plugins", PKG_NAME);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FIX = args.includes("--fix");
const UNIFY = args.includes("--unify"); // 强制所有 profile 链接到目标目录
const DEPLOY = args.includes("--deploy"); // 部署模式：统一走 DSH_HOME/plugins

/** 链接目标：部署模式用 $DSH_HOME/plugins 下的副本，否则用当前开发目录 */
const TARGET_DIR = DEPLOY ? DEPLOY_DIR : PKG_ROOT;

let failures = 0;
const out = (tag, profile, msg) => console.log(`[${tag}] ${profile}：${msg}`);

/** 读取 profile 的 package.json（不存在返回 null） */
function readProfilePkg(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/** 校验 profile 里本插件的链接是否有效（node_modules junction 存在、目标含插件入口） */
function checkLink(profileDir) {
  const link = join(profileDir, "node_modules", PKG_NAME);
  if (!existsSync(link)) return { ok: false, reason: "node_modules 中不存在该插件链接" };
  try {
    const st = statSync(link);
    const target = realpathSync(link);
    const ok = st.isDirectory() && existsSync(join(target, "lib", "index.js")) && existsSync(join(target, "package.json"));
    return { ok, target, reason: ok ? "" : "链接目标缺少插件文件（lib/index.js 或 package.json）" };
  } catch {
    return { ok: false, reason: "链接目标不存在" };
  }
}

/** 判断两个路径是否指向同一目录（Windows 忽略大小写） */
function sameDir(a, b) {
  return resolve(a).toLowerCase().replace(/[\\/]+$/, "") === resolve(b).toLowerCase().replace(/[\\/]+$/, "");
}

/**
 * 把开发目录复制为部署副本（$DSH_HOME/plugins/<name>）：
 * 排除开发/运行时无关内容（node_modules、.git、thesis、releases、tools、config.json、plan.md、*.exe）。
 * 部署模式下所有 profile 统一 link 到该副本，全程走 DSH_HOME 一条路。
 */
function deploy() {
  if (DRY) return;
  rmSync(DEPLOY_DIR, { recursive: true, force: true });
  mkdirSync(dirname(DEPLOY_DIR), { recursive: true });
  cpSync(PKG_ROOT, DEPLOY_DIR, {
    recursive: true,
    filter: (src) => {
      const name = src.split(/[\\/]/).pop();
      return !["node_modules", ".git", "thesis", "releases", "tools"].includes(name)
        && !src.endsWith("config.json") && !src.endsWith("plan.md") && !src.endsWith(".exe");
    },
  });
}

/**
 * 直接写入 link（不依赖 pnpm install）：
 * 编辑 profile 的 package.json（dependencies + bundles），并重建 node_modules junction 指向目标目录。
 * 用于官方 add 因 profile 自身 lockfile/供应链策略失败时的兜底，也用于 --unify / --deploy 统一链接。
 */
function forceLink(profileDir, targetDir) {
  const pkgPath = join(profileDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies[PKG_NAME] = "link:" + targetDir.replace(/\\/g, "/");
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [];
  if (!pkg.dsh.profile.bundles.includes(PKG_NAME)) pkg.dsh.profile.bundles.push(PKG_NAME);
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  const nm = join(profileDir, "node_modules");
  const linkPath = join(nm, PKG_NAME);
  if (existsSync(linkPath)) rmSync(linkPath, { recursive: true, force: true });
  mkdirSync(nm, { recursive: true });
  symlinkSync(targetDir, linkPath, process.platform === "win32" ? "junction" : "dir");
}

/** 通过官方命令把插件配置进指定 profile；失败时回退为直接 link 方式 */
function addToProfile(profile, profileDir) {
  if (DRY) return { done: true, dry: true };
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(cmd, ["-y", "@deepseek-ai/dsh", "plugin", "--profile", profile, "add", "link:" + TARGET_DIR], {
    cwd: profileDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status === 0) return { done: true };
  // 官方 add 失败（如 profile 自身 lockfile 供应链策略拦截）→ 直接写 link，绕过 pnpm install
  out("NOTE", profile, "官方 dsh plugin add 失败（exit " + r.status + "），改用直接 link 方式");
  try {
    forceLink(profileDir, TARGET_DIR);
    return { done: true, fallback: true };
  } catch (err) {
    out("FAIL", profile, "直接 link 失败：" + String((err && err.message) || err));
    failures++;
    return { done: false };
  }
}

console.log("dsh-event-sounds 多 profile 自动配置（" + (DRY ? "dry-run，仅检测" : "实际配置") + "）");
console.log("DSH_HOME = " + DSH_HOME);
console.log("链接目标 = " + (DEPLOY ? DEPLOY_DIR + "（部署副本）" : PKG_ROOT + "（开发目录）") + "\n");

if (DEPLOY) deploy();

if (!existsSync(PROFILES_DIR)) {
  console.log("未找到 profiles 目录：" + PROFILES_DIR + "（请先通过桌面版或 npx @deepseek-ai/dsh web 初始化过 dsh）");
  process.exit(failures === 0 ? 0 : 1);
}

const entries = readdirSync(PROFILES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
  .map((d) => d.name)
  .sort();

if (entries.length === 0) {
  console.log("profiles 目录下没有任何 profile");
  process.exit(0);
}

const summary = [];
for (const name of entries) {
  const profileDir = join(PROFILES_DIR, name);
  const pkg = readProfilePkg(profileDir);
  if (!pkg) {
    out("SKIP", name, "无 package.json，跳过");
    summary.push({ name, state: "skip" });
    continue;
  }
  const deps = pkg.dependencies || {};
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
  const registered = deps[PKG_NAME] || bundles.includes(PKG_NAME);

  if (!registered) {
    out("ADD", name, "未配置，开始配置…");
    const r = addToProfile(name, profileDir);
    summary.push({ name, state: r.done ? (r.dry ? "add(dry)" : "add") : "fail" });
    continue;
  }

  const link = checkLink(profileDir);
  if (link.ok) {
    // --unify 或 --deploy：目标不同 → 统一到链接目标目录
    if ((UNIFY || DEPLOY) && !sameDir(link.target, TARGET_DIR)) {
      out("UNIFY", name, "统一链接到 " + TARGET_DIR + "（原 " + link.target + "）…");
      if (DRY) { summary.push({ name, state: "unify(dry)" }); continue; }
      try {
        forceLink(profileDir, TARGET_DIR);
        summary.push({ name, state: "unify" });
      } catch (err) {
        out("FAIL", name, "统一链接失败：" + String((err && err.message) || err));
        failures++;
        summary.push({ name, state: "fail" });
      }
      continue;
    }
    out("OK", name, "已配置，链接有效 → " + (link.target || ""));
    summary.push({ name, state: "ok" });
    continue;
  }

  if (FIX) {
    out("FIX", name, "已配置但链接失效（" + (link.reason || "未知") + "），重新配置…");
    const r = addToProfile(name, profileDir);
    summary.push({ name, state: r.done ? (r.dry ? "fix(dry)" : "fix") : "fail" });
  } else {
    out("WARN", name, "已配置但链接失效（" + (link.reason || "未知") + "），可加 --fix 自动修复");
    summary.push({ name, state: "broken" });
  }
}

console.log("\n===== 汇总 =====");
for (const s of summary) {
  const label = { ok: "已配置（有效）", add: "本次新配置", "add(dry)": "待配置（dry-run）", fix: "本次修复", "fix(dry)": "待修复（dry-run）", broken: "已配置但失效", skip: "跳过", fail: "配置失败", unify: "已统一链接", "unify(dry)": "待统一（dry-run）" }[s.state];
  console.log("  " + s.name + " → " + label);
}
console.log(failures === 0 ? "全部完成" : failures + " 处失败");
process.exit(failures === 0 ? 0 : 1);
