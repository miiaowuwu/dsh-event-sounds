import type { Context } from "@deepseek-ai/cordis"

/**
 * `dsh-sound-lab` 的配置结构。
 *
 * 浏览器端持久化于 localStorage（键 `dsh.soundsControl.v1`），
 * 宿主端同时落盘到插件目录 `config.json`（双持久化，换浏览器/清缓存不丢）。
 */
export interface EventSoundsTrigger {
  /** 是否启用该触发条件 */
  on: boolean
  /**
   * 音效取值：
   * - `""` —— 内置提示音（Web Audio 琶音，不依赖音频文件）
   * - `"__none__"` —— 不播放
   * - 其它 —— 音效库中的具体音频文件名
   */
  sound: string
}

export interface EventSoundsConfig {
  /** 配置弹窗标题的语音名字 */
  title: string
  /** 音量 0~1（默认 0.75） */
  volume: number
  /** 外观风格：maid（鲸鱼娘）| white（纯白）| black（纯黑） */
  style: "maid" | "white" | "black"
  /** 四个触发条件各自的启用与音效 */
  triggers: {
    end: EventSoundsTrigger
    question: EventSoundsTrigger
    approval: EventSoundsTrigger
    stop: EventSoundsTrigger
  }
  /** 测试音效下拉的选择记忆（"" 或 `"__default__"` 表示内置提示音，或具体文件名） */
  testSound: string
}

export declare const name: "ui-event-sounds-host"
export declare const inject: string[]
export declare function apply(ctx: Context): Promise<void>
