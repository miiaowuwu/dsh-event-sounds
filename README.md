# dsh-event-sounds —— 语音控制插件（安洁莉娜「hirari do～」）

DSH Web GUI 客户端插件：在对话「**会话结束 / 弹出选项 / 请求许可 / 停止**」时播放指定音效。

> 🐋 角色引用：本项目为《明日方舟》（Arknights）角色 **安洁莉娜（Angelina）** 的粉丝向自制项目，默认示例音效为安洁莉娜「hirari do～」与「呢？」语音片段，仅供个人学习与娱乐使用，**不用于任何商业用途**。

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
├── README.md
├── LICENSE
├── sounds/             # ★ 把音频文件放这里（mp3/wav/ogg 等）
└── lib/
    ├── index.js        # 宿主端：/dsh-sounds-control 静态服务（list/config/音频）
    └── client.js       # 浏览器端：悬浮球 + 配置弹窗 + 触发监测 + 播放
```

## 双端结构

插件由 **宿主端 + 浏览器端** 两半组成，随单个安装包一并自动加载：

- **宿主端（Node 半）** [lib/index.js](lib/index.js)：运行在 DSH 主进程（Node），把插件包 `sounds/` 目录通过 `/dsh-sounds-control` 静态服务暴露给浏览器端（音效列表 / 音频文件 / config.json 持久化）
- **浏览器端（Web GUI 半）** [lib/client.js](lib/client.js)：运行在 DSH 的 Web GUI 页面，负责悬浮球、配置弹窗、触发监测与音效播放

两半的挂载由 `package.json` 声明驱动，无需手动分开安装：

- `dsh.client` 声明（`exports "./client"`）→ 驱动浏览器端在 Web GUI 加载
- `dsh.bundle.patch`（[cordis.patch.yml](cordis.patch.yml)）→ 驱动宿主端在 DSH 主进程注册

## 安装

### 前置要求

- 已安装 DSH 桌面端（提供 `dsh` CLI）
- 本插件为 **热插拔** 插件：无需改动 DSH 源码，安装后重启 DSH 桌面端即可生效

### 方式一：从 GitHub 安装（推荐）

```bash
dsh plugin --profile desktop add github:miiaowuwu/dsh-event-sounds
```

安装完成后**重启 DSH 桌面端**，浏览器界面右上角会短暂显示绿色「dsh-event-sounds 已加载」提示，并出现 🔊 悬浮球即表示安装成功。

更新插件：

```bash
dsh plugin --profile desktop update dsh-event-sounds
```

### 方式二：手动挂载（本地开发 / 离线使用）

1. 将本目录链接到 DSH profile 的 `node_modules/dsh-client-ui-event-sounds`
2. 在 profile 的 `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中登记
3. 执行 `pnpm install`
4. 重启 DSH 桌面端

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
