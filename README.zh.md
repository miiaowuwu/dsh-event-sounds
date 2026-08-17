# dsh-event-sounds —— 语音控制插件（安洁莉娜「hirari do～」）

[English](README.md) | 中文

DSH Web GUI 客户端插件：在对话「**会话结束 / 弹出选项 / 请求许可 / 停止**」时播放指定音效。

> 🐋 角色引用：本项目为《明日方舟》（Arknights）角色 **安洁莉娜（Angelina）** 的粉丝向自制项目，默认示例音效为安洁莉娜「hirari do～」与「呢？」语音片段，仅供个人学习与娱乐使用，**不用于任何商业用途**。

## 安装

两种方式对**两类用户（桌面版 / web 版）都适用**，任选其一即可。

**方式一：Setup 安装器（推荐，零依赖，两种用户都可用）**

1. **退出正在运行的 dsh**（桌面应用或 `dsh web` 服务）
2. 下载 [dsh-event-sounds-Setup-1.1.0-x64.exe](https://github.com/miiaowuwu/dsh-event-sounds/releases/latest/download/dsh-event-sounds-Setup-1.1.0-x64.exe)，**双击**
3. **重启**，看到 🔊 悬浮球即安装成功

安装器把插件部署到 `$DSH_HOME\plugins\dsh-client-ui-event-sounds`，并扫描 `$DSH_HOME\profiles` 下**所有已初始化的 profile**（web / desktop / …）逐一调用官方 `dsh plugin` 命令登记，使各 profile 共用同一份部署副本；若本机没有 dsh CLI，会自动穷举补齐（桌面应用自带 runtime → 系统 npx → 自动下载 Node.js）。全程自动化，不手改任何配置。

- **更新**：重新双击 Setup exe 并重启
- **卸载**：双击 [dsh-event-sounds-UnSetup-1.1.0-x64.exe](https://github.com/miiaowuwu/dsh-event-sounds/releases/latest/download/dsh-event-sounds-UnSetup-1.1.0-x64.exe) 并重启

**方式二：dsh CLI（需 Node.js，两种用户都可用）**

```bash
npx @deepseek-ai/dsh plugin --profile desktop add github:miiaowuwu/dsh-event-sounds   # 桌面版用户
npx @deepseek-ai/dsh plugin --profile web add github:miiaowuwu/dsh-event-sounds      # web 用户
npx @deepseek-ai/dsh web
```

> GitHub 访问不稳定时改用本地路径安装：`npx @deepseek-ai/dsh plugin --profile <name> add link:D:/你的路径/dsh-event-sounds`
>
> 开发便利：`npm run setup` 自动检测本机所有 profile 并逐一登记本插件；`npm run setup:deploy` 把副本部署到 `$DSH_HOME/plugins` 并让所有 profile 指向它（发布/固定使用模式）。加 `--profile <name>`（如 `node tools/install.mjs --profile web --unify`）可只操作单个 profile。

## 功能

- **可拖动悬浮球**（🔊）：按住拖到屏幕任意位置；**拖到屏幕边缘自动缩成「只有 > 图标」的小半球**；点击打开配置弹窗；位置持久化，默认靠左
- **配置弹窗**：可拖动（按住标题栏）、z-index 置顶
  - 触发条件 × 4：**会话结束 / 弹出选项 / 请求许可 / 停止**，每个独立【启用勾选 + 音效下拉】，下拉可选 **内置提示音 / 不播放 / 具体音效**（「内置提示音」为 Web Audio 琶音，不依赖音频文件）
  - **注意类事件**（弹出选项 / 请求许可）始终响铃：出现即播，不受会话运行/查看状态限制，且优先于完成类音效
  - **外观风格**：鲸鱼娘（默认）/ 纯白 / 纯黑 + **语音名字可自定义**
  - 音量滑杆（0–100%）、**测试音效** 下拉（含「内置提示音」选项）+ ▶ 试听 + 状态栏、重置按钮位置
  - 音效库（插件 `sounds/` 文件夹的本地音频）+ 刷新 + **「自定义」弹窗：选择/拖拽上传音频、删除音效、恢复被隐藏的附带音效**
- **音效来源**：插件包 `sounds/` 目录的本地音频文件（mp3/wav/ogg/m4a/flac/opus/aac/wma/webm），宿主端经 `/dsh-sounds-control` 静态服务（Range/206 分片、ETag、流式）提供
- **配置持久化**：localStorage + 宿主端 `config.json` 双写，重启不丢；加载时逐字段清洗（类型/范围/枚举），脏数据回退默认值
- **启动即预加载**：打开软件时自动拉取配置与音效列表并缓冲配置的音效，首次播放秒出
- 默认配置：音量 75%；会话结束 →「hirari do～」、弹出选项/请求许可 →「呢？」、停止 → 内置提示音
- 未选择/加载失败时自动播放 Web Audio 内置提示音兜底
- **开发工程化**：`npm test`（宿主端 list/config/upload/delete 与浏览器端逻辑的 Node 冒烟测试）、`npm run setup` / `setup:fix` / `setup:deploy`（多 profile 自动配置）、`releases/build-single-exe.ps1`（打包 Setup/UnSetup 安装器）

## 目录结构

```
dsh-event-sounds/
├── package.json          # 包声明（dsh.client / dsh.bundle.patch / types / scripts）
├── cordis.patch.yml      # 组成补丁：挂载行 ui-event-sounds
├── CHANGELOG.md          # 版本记录
├── README.md
├── LICENSE
├── sounds/               # 开发时把音频文件放这里（mp3/wav/ogg 等）
├── lib/
│   ├── index.js          # 宿主端：/dsh-sounds-control 静态服务（list/config/音频）
│   ├── client.js         # 浏览器端：悬浮球 + 配置弹窗 + 触发监测 + 播放
│   └── types/index.d.ts  # 类型声明
├── tools/
│   ├── install.mjs       # 多 profile 自动配置（setup / --fix / --unify / --deploy）
│   ├── test-host.mjs     # 宿主端接口冒烟测试（list/config/upload/delete）
│   └── test-client.mjs   # 浏览器端逻辑冒烟测试
└── releases/             # 发布：build-single-exe.ps1 + 各版本 Setup/UnSetup exe（不入库）
```

## 双端结构

插件由 **宿主端 + 浏览器端** 两半组成，随单个安装包一并自动加载：

- **宿主端（Node 半）** [lib/index.js](lib/index.js)：运行在 DSH 主进程（Node），把插件包 `sounds/` 目录通过 `/dsh-sounds-control` 静态服务暴露给浏览器端（音效列表 / 音频文件 / config.json 持久化）
- **浏览器端（Web GUI 半）** [lib/client.js](lib/client.js)：运行在 DSH 的 Web GUI 页面，负责悬浮球、配置弹窗、触发监测与音效播放

两半的挂载由 `package.json` 声明驱动，无需手动分开安装：

- `dsh.client` 声明（`exports "./client"`）→ 驱动浏览器端在 Web GUI 加载
- `dsh.bundle.patch`（[cordis.patch.yml](cordis.patch.yml)）→ 驱动宿主端在 DSH 主进程注册

由于 dsh 插件**按 profile 隔离**（`$DSH_HOME/profiles/<name>` 各自持有 `package.json` / `node_modules`），需要哪个 profile 用就必须在哪个 profile 登记——这正是安装器与 `tools/install.mjs` 自动完成的事（见[安装](#安装)）。

## 使用

1. **准备音效**：开发时把音频文件放入仓库 `sounds/` 目录（见上方目录树）；已安装使用时无需手动找文件夹——打开配置弹窗 → 音效库 → **「自定义」**，选择本地文件或拖拽导入即可（自动复制进安装位置的 `sounds/` 目录），也可在列表中删除音效（附带音效为隐藏，可随时恢复）。
2. **打开配置弹窗**：点击 🔊 悬浮球
3. **刷新音效列表**：点击「刷新」，插件会枚举 `sounds/` 下的所有音频文件
4. **配置触发条件**：对「会话结束 / 弹出选项 / 请求许可 / 停止」四个事件，分别【勾选启用 + 选择音效】，下拉可选「内置提示音 / 不播放 / 具体音效」（「内置提示音」为 Web Audio 琶音，不依赖音频文件）
5. **测试音效**：在「测试音效」下拉中选择音效并点击 ▶ 试听（下拉含「内置提示音」选项，选它或未指定时试听 Web Audio 琶音）。配合音量滑杆（0–100%）调整音量
6. **生效**：之后对话中的对应事件会自动播放所选音效；未选择或加载失败时会自动播放内置提示音兜底

> 提示：悬浮球可拖到屏幕任意位置，拖到屏幕边缘会自动缩成小半球；「外观」里可切换 鲸鱼娘 / 纯白 / 纯黑 风格；位置与配置会自动保存，重启不丢。

## 免责声明

- 本项目为 **粉丝向（非官方）个人项目**，与《明日方舟》官方及上海鹰角网络科技有限公司（Hypergryph）无任何隶属、赞助或授权关系。
- 项目中引用的角色形象、名称、台词及语音素材（含安洁莉娜「hirari do～」「呢？」语音）版权归《明日方舟》官方及其相关权利人所有；语音的著作权归相应的配音演员所有。
- 本项目仅用于个人学习、研究与娱乐，**不用于任何商业用途**，不以此牟利。
- 项目自带的音效素材来源于使用者自行放入的本地音频文件，使用者须确保其使用方式符合相关法律法规及原权利人的要求。
- 如相关权利人认为本项目的任何内容构成侵权，请联系项目作者删除相关素材，我们将立即处理。
- 本项目按现状提供，作者不对因使用本项目产生的任何后果负责。
