/**
 * 搜索历史（本地）—— 只记**关键词字符串**。
 *
 * ⚠️ 与「浏览历史」（`utils/store.js`）不是一回事，存储键也分开：
 *   浏览历史 = 看过的帖子（对象数组，上限 50），在 `STORAGE_KEYS.HISTORY`；
 *   搜索历史 = 搜过的词（字符串数组，上限 10），在 `STORAGE_KEYS.SEARCH_HISTORY`。
 *
 * 📌 为什么上限只有 10：这一块在搜索页是「未搜索态」的辅助入口，
 *   排布在热门标签上方。超过一屏就变成噪音，反而挤掉了真正的内容入口。
 *
 * 全部同步 API（`uni.getStorageSync`）：数据量极小，不引入异步复杂度。
 */

import { STORAGE_KEYS } from '../api/config'

const MAX = 10

function read() {
  try {
    const v = uni.getStorageSync(STORAGE_KEYS.SEARCH_HISTORY)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []
  } catch (e) {
    return []
  }
}

function write(list) {
  try {
    uni.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, list)
  } catch (e) {
    /* 存储满 / 不可用时静默降级：历史只是锦上添花，绝不能因此打断搜索 */
  }
}

/** 最近搜索的词（最新在前） */
export function getSearchHistory() {
  return read()
}

/**
 * 记录一次搜索。
 *
 * 去重规则：**忽略大小写**（搜过 `rpg` 再搜 `RPG` 不应出现两条），
 * 保留用户最后一次的原始写法（所以是「先删旧的、再把新的放最前」）。
 *
 * @param {string} keyword
 * @returns {string[]} 更新后的列表（页面可直接赋值，省一次读）
 */
export function addSearchHistory(keyword) {
  const kw = String(keyword || '').trim()
  if (!kw) return read()
  const list = read().filter((x) => x.toLowerCase() !== kw.toLowerCase())
  list.unshift(kw)
  const out = list.slice(0, MAX)
  write(out)
  return out
}

/** 删除单条（目前页面没用到，留给「长按删除」这类后续交互） */
export function removeSearchHistory(keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return read()
  const out = read().filter((x) => x.toLowerCase() !== kw)
  write(out)
  return out
}

/** 清空 */
export function clearSearchHistory() {
  write([])
  return []
}
