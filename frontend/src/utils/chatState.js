/**
 * 私信的跨组件协调状态（模块级单例）。
 *
 * 解决的问题：私信消息已经能经 WebSocket 实时进聊天流，但「布局层」的 TopBar
 * 并不知道你正开着谁的对话框，于是会出现两种脱节：
 *   1. 消息都已经出现在聊天流里了，右上角还在弹「新私信」通知 → 重复打扰；
 *   2. 进了会话、后端已读也清了，TopBar 的私信红点却因为「拉取早于已读」而残留。
 *
 * 所以这里放两个最小的共享信号（都只有一丁点数据，不值得为它们新建 Pinia store）：
 *   - activePeerId：当前打开的会话对象 id（Messages.vue 写，TopBar 读）
 *   - readTick    ：已读信号自增计数（Messages.vue 写，TopBar 监听后刷新未读）
 */
import { ref } from 'vue'

/** 当前打开的会话对象 id；未打开任何会话时为 null。 */
export const activePeerId = ref(null)

/** 是否正在与某人聊天（做 Number 归一，避免字符串 id 与数字 id 比较失败）。 */
export function isChattingWith(userId) {
  if (userId == null || activePeerId.value == null) return false
  return Number(userId) === Number(activePeerId.value)
}

/** 私信已读信号：每标记一次已读自增 1，TopBar 监听它刷新未读数。 */
export const readTick = ref(0)

export function bumpReadTick() {
  readTick.value += 1
}
