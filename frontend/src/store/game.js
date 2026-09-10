import { defineStore } from 'pinia'
import { getBoards } from '@/api/community'

/**
 * 1.2 全局「当前选中游戏」上下文 + 板块帖数统计。
 * 进入游戏库选择某游戏后，左侧板块、首页/板块/游戏详情的帖子流都以该游戏为过滤维度；
 * 不选游戏时展示全部游戏的帖子。持久化到 localStorage，刷新后保持。
 *
 * 设计要点（避免侧栏/首页/详情重复拉取 + 不同步）：
 *  - 把"当前 gameId 下每个板块的帖数"缓存进 store（perGameBoardCounts），侧栏只读不取；
 *  - 切换/清除游戏时由 store 自身 action 拉取，组件不需要 watch；
 *  - 任何组件读 currentBoardCounts 即可拿到按当前 game 过滤的 {boardId: count} 映射。
 */
const STORAGE_KEY = 'yumu_current_game'

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export const useGameStore = defineStore('game', {
  state: () => ({
    currentGame: loadInitial(), // { id, name, cover } | null
    allBoardCounts: {},         // [boardId]: count，无选中游戏时使用
    perGameBoardCounts: {},      // [gameId]: { [boardId]: count }
    boardStatsLoading: false     // 防止并发拉取
  }),
  getters: {
    currentGameId: (state) => (state.currentGame ? state.currentGame.id : null),
    hasGame: (state) => !!state.currentGame,
    // 当前上下文下的板块帖数映射：选中游戏时取 perGame，否则取 allBoardCounts
    currentBoardCounts: (state) => {
      if (state.currentGame) {
        return state.perGameBoardCounts[state.currentGame.id] || {}
      }
      return state.allBoardCounts
    }
  },
  actions: {
    setGame(game) {
      // game 可为 {id,name,cover} 或 null
      this.currentGame = game ? { id: game.id, name: game.name, cover: game.cover } : null
      if (this.currentGame) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentGame))
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
      // game 切换/清除后立即按需刷板块统计（侧栏/首页/详情通用）
      this.refreshBoardStats()
    },
    clearGame() {
      this.setGame(null)
    },
    /**
     * 按当前 currentGameId 拉板块帖数。
     *  - 无游戏 → 拉 /boards（全站统计），结果写入 allBoardCounts；
     *  - 有游戏 → 拉 /boards?gameId=X，结果写入 perGameBoardCounts[gameId]，并顺带填充 allBoardCounts。
     * 重复调用是幂等的，已缓存则跳过。
     */
    async refreshBoardStats() {
      if (this.boardStatsLoading) return
      this.boardStatsLoading = true
      try {
        const gameId = this.currentGame ? this.currentGame.id : null
        // 全站统计（始终需要，用于无游戏兜底）
        if (Object.keys(this.allBoardCounts).length === 0) {
          const all = await getBoards(null)
          const m = {}
          ;(all || []).forEach((b) => { m[b.id] = b.postCount || 0 })
          this.allBoardCounts = m
        }
        // 当前游戏的统计（按需缓存）
        if (gameId != null && !this.perGameBoardCounts[gameId]) {
          const per = await getBoards(gameId)
          const m = {}
          ;(per || []).forEach((b) => { m[b.id] = b.postCount || 0 })
          this.perGameBoardCounts = { ...this.perGameBoardCounts, [gameId]: m }
        }
      } catch (e) {
        // 静默失败：保留已有计数（默认 0）
      } finally {
        this.boardStatsLoading = false
      }
    }
  }
})
