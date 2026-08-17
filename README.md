# dsh-event-sounds —— 语音控制插件（安洁莉娜「hirari do～」）

DSH Web GUI 客户端插件：在对话「**会话结束 / 弹出选项 / 请求许可 / 停止**」时播放指定音效。

> 🐋 角色引用：本项目为《明日方舟》（Arknights）角色 **安洁莉娜（Angelina）** 的粉丝向自制项目，默认示例音效为安洁莉娜「hirari do～」与「呢？」语音片段，仅供个人学习与娱乐使用，**不用于任何商业用途**。

## 安装

按你使用 DSH 的方式二选一，其余全部自动完成。

### 前置要求（缺什么装什么）

| 使用方式 | 需要哪些工具 | 缺了怎么办 |
|----------|--------------|-----------|
| **场景一：桌面应用** | 无（脚本用**应用自带的 pnpm**） | 什么都不用装 |
| **场景二：`npx @deepseek-ai/dsh web`** | Node.js + pnpm + git | 按下面表格装 |

**场景二缺工具时的安装方法（Windows）：**

| 工具 | 用途 | 安装方法 | 验证 |
|------|------|----------|------|
| Node.js | 运行 npx / pnpm | `winget install OpenJS.NodeJS.LTS`，或到 https://nodejs.org 下载安装包 | `node -v` |
| pnpm | dsh plugin 依赖的包管理器 | 装好 Node 后执行 `npm i -g pnpm`（或 `corepack enable pnpm`） | `pnpm -v` |
| git | 从 GitHub 安装插件 | `winget install Git.Git`，或到 https://git-scm.com 下载 | `git --version` |

> 提示：安装完新工具后**重开一个终端**再执行安装命令，否则 PATH 不生效。

### 场景一：使用桌面应用（DeepSeek Harness Desktop）—— 推荐

> 无需安装 node / pnpm，安装包用应用自带的运行时，全程自动化。

1. **先退出 DeepSeek Harness Desktop**（安装/卸载时应用不应处于运行状态）
2. **从 [Releases](https://github.com/miiaowuwu/dsh-event-sounds/releases) 下载 [dsh-event-sounds-Setup-1.0.0-x64.exe](#)，双击即装**（自包含单文件，内嵌全部插件文件，解压到 `%LOCALAPPDATA%\dsh-event-sounds`）
3. 看到绿色「安装完成」后，**重启 DeepSeek Harness Desktop** 即可

安装器会自动完成：复用桌面应用自带的 exe（`ELECTRON_RUN_AS_NODE` 模式，当作通用 Node 运行时）调用**官方 `dsh plugin --profile desktop add link:<插件路径>`**，由官方 CLI 自动登记 `dependencies` + `bundles` 并用应用自带的 pnpm 安装依赖——不手改任何配置。可重复执行。

### 场景二：使用 `npx @deepseek-ai/dsh web`

需要全局 node + pnpm + git（缺什么见上面的前置表格）：

```bash
# 安装（二选一：GitHub 或本地路径）
npx @deepseek-ai/dsh plugin --profile web add github:miiaowuwu/dsh-event-sounds
# npx @deepseek-ai/dsh plugin --profile web add link:D:/你的路径/dsh-event-sounds

# 启动 web（装完重启即生效）
npx @deepseek-ai/dsh web
```

> `dsh plugin` 会自动把声明了 `dsh.bundle` 的插件登记进 profile 的 `bundles` 列表，无需手动改配置。
>
> 提示：国内网络访问 GitHub 不稳定，如果 `github:` 安装报 `ECONNRESET` / `ETIMEDOUT` 超时，改用**本地路径**安装即可（把插件文件夹下载/放在本地后）：
> `npx @deepseek-ai/dsh plugin --profile web add link:D:/你的路径/dsh-event-sounds`

### 安装成功标志 & 更新 / 卸载

- **成功标志**：Web 界面右上角短暂显示绿色「dsh-event-sounds 已加载」提示，并出现悬浮球
- **更新**：桌面应用场景重新双击 `dsh-event-sounds-Setup-1.0.0-x64.exe` 后重启；web 场景执行 `npx @deepseek-ai/dsh plugin --profile web update dsh-client-ui-event-sounds`
- **卸载**：桌面应用场景双击 `dsh-event-sounds-UnSetup-1.0.0-x64.exe` 后重启；web 场景执行 `npx @deepseek-ai/dsh plugin --profile web remove dsh-client-ui-event-sounds`

> **重新生成发布 exe**：先 `Install-Module ps2exe -Scope CurrentUser`（仅首次），再执行 `& build-single-exe.ps1`，产物自动同步到 `releases\<版本>\`。详细说明见 `releases/<版本>/resources/BUILD.md`；版本/架构在脚本顶部修改。

## 功能

- **可拖动悬浮球**（🔊）：按住拖到屏幕任意位置；**拖到屏幕边缘自动缩成「只有 > 图标」的小半球**；点击打开配置弹窗；位置持久化，默认靠左
- **配置弹窗**：可拖动（按住标题栏）、z-index 置顶
  - 触发条件 × 4：**会话结束 / 弹出选项 / 请求许可 / 停止**，每个独立【启用勾选 + 音效下拉】
  - **外观风格**：鲸鱼娘（默认）/ 纯白 / 纯黑
  - 音量滑杆（0–100%）、▶ 播放测试 + 状态栏、重置按钮位置
  - 音效库（插件 `sounds/` 文件夹的本地音频）+ 刷新
- **音效来源**：插件包 `sounds/` 目录的本地音频文件（mp3/wav/ogg/m4a/flac/opus/aac/wma/webm），宿主端经 `/dsh-sounds-control` 静态服务（Range/206 分片、ETag、流式）提供
- **配置持久化**：localStorage + 宿主端 `config.json` 双写，重启不丢
- **启动即预加载**：打开软件时自动拉取配置与音效列表并缓冲配置的音效，首次播放秒出
- 未选择/加载失败时自动播放 Web Audio 内置提示音兜底

## 目录结构

```
dsh-event-sounds/
├── package.json        # 包声明（dsh.client / dsh.bundle.patch）
├── cordis.patch.yml    # 组成补丁：挂载行 ui-event-sounds
├── build-single-exe.ps1# ★ 生成发布 exe 的构建脚本（产物进 releases\<版本>\）
├── README.md
├── LICENSE
├── sounds/             # ★ 把音频文件放这里（mp3/wav/ogg 等）
├── lib/
│   ├── index.js        # 宿主端：/dsh-sounds-control 静态服务（list/config/音频）
│   └── client.js       # 浏览器端：悬浮球 + 配置弹窗 + 触发监测 + 播放
└── releases/
    └── 1.0.0/           # ★ 发布产物（上传到 GitHub Releases）
        ├── dsh-event-sounds-Setup-1.0.0-x64.exe    # 自包含安装器（双击安装）
        ├── dsh-event-sounds-UnSetup-1.0.0-x64.exe  # 自包含卸载器（双击卸载）
        └── resources/BUILD.md                    # 构建说明（如何重新生成 exe）
```

## 双端结构

插件由 **宿主端 + 浏览器端** 两半组成，随单个安装包一并自动加载：

- **宿主端（Node 半）** [lib/index.js](lib/index.js)：运行在 DSH 主进程（Node），把插件包 `sounds/` 目录通过 `/dsh-sounds-control` 静态服务暴露给浏览器端（音效列表 / 音频文件 / config.json 持久化）
- **浏览器端（Web GUI 半）** [lib/client.js](lib/client.js)：运行在 DSH 的 Web GUI 页面，负责悬浮球、配置弹窗、触发监测与音效播放

两半的挂载由 `package.json` 声明驱动，无需手动分开安装：

- `dsh.client` 声明（`exports "./client"`）→ 驱动浏览器端在 Web GUI 加载
- `dsh.bundle.patch`（[cordis.patch.yml](cordis.patch.yml)）→ 驱动宿主端在 DSH 主进程注册

## 使用

1. **准备音效**：把音频文件放入插件包根目录的 `sounds/` 文件夹（支持 mp3/wav/ogg/m4a/flac/opus/aac/wma/webm），例如安洁莉娜「hirari do～」、「呢？」语音片段
2. **打开配置弹窗**：点击 🔊 悬浮球
3. **刷新音效列表**：点击「刷新」，插件会枚举 `sounds/` 下的所有音频文件
4. **配置触发条件**：对「会话结束 / 弹出选项 / 请求许可 / 停止」四个事件，分别【勾选启用 + 选择音效】
5. **播放测试**：点击 ▶ 验证声音，配合音量滑杆（0–100%）调整音量
6. **生效**：之后对话中的对应事件会自动播放所选音效；未选择或加载失败时会自动播放内置提示音兜底

> 提示：悬浮球可拖到屏幕任意位置，拖到屏幕边缘会自动缩成小半球；「外观」里可切换 鲸鱼娘 / 纯白 / 纯黑 风格；位置与配置会自动保存，重启不丢。

## 免责声明

- 本项目为 **粉丝向（非官方）个人项目**，与《明日方舟》官方及上海鹰角网络科技有限公司（Hypergryph）无任何隶属、赞助或授权关系。
- 项目中引用的角色形象、名称、台词及语音素材（含安洁莉娜「hirari do～」「呢？」语音）版权归《明日方舟》官方及其相关权利人所有；语音的著作权归相应的配音演员所有。
- 本项目仅用于个人学习、研究与娱乐，**不用于任何商业用途**，不以此牟利。
- 项目自带的音效素材来源于使用者自行放入的本地音频文件，使用者须确保其使用方式符合相关法律法规及原权利人的要求。
- 如相关权利人认为本项目的任何内容构成侵权，请联系项目作者删除相关素材，我们将立即处理。
- 本项目按现状提供，作者不对因使用本项目产生的任何后果负责。
