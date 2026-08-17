# sounds-control —— 语音控制插件（安洁莉娜「hirari do～」）

DSH Web GUI 客户端插件：在对话「**会话结束 / 弹出选项 / 请求许可 / 停止**」时播放指定音效。

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
sounds-control/
├── package.json        # 包声明（dsh.client / dsh.bundle.patch）
├── cordis.patch.yml    # 组成补丁：挂载行 ui-sounds-control
├── README.md
├── LICENSE
├── sounds/             # ★ 把音频文件放这里（mp3/wav/ogg 等）
└── lib/
    ├── index.js        # 宿主端：/dsh-sounds-control 静态服务（list/config/音频）
    └── client.js       # 浏览器端：悬浮球 + 配置弹窗 + 触发监测 + 播放
```

## 安装

从 GitHub 安装（推荐）：

```bash
dsh plugin --profile desktop add github:<owner>/<repo>
```

或手动挂载：把本目录链接到 DSH profile 的 `node_modules/dsh-client-ui-sounds-control`，
在 profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中登记后 `pnpm install`，
再重启 DSH 桌面端。

## 使用

1. 把音频文件（如安洁莉娜「hirari do～」语音片段）放入 `sounds/` 文件夹
2. 点击悬浮球打开配置弹窗 → 「刷新」音效列表 → 为各触发条件选择音效
3. ▶ 播放测试 验证声音；之后对话中的对应事件会自动播放
4. 「外观」里可切换 鲸鱼娘 / 纯白 / 纯黑 风格

> 版权提示：请勿把游戏版权语音素材（如明日方舟干员语音）提交到公开仓库；
> 仓库默认忽略用户放入 `sounds/` 的音频文件（仅保留说明文件），音频由使用者自行放入。
