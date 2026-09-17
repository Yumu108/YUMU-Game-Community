/**
 * 分页列表通用逻辑 —— 新闻 / 攻略列表 / 游戏帖子 / 游戏库 四个页面共用。
 *
 * 为什么抽出来：这四页原本各自抄了一份 `load()`，于是「失败当空数据」这个 bug
 * 也**被抄了四遍**（2026-09-17 体检发现的 Z-offline 现象就属于这种系统性错误）。
 * 收敛到一处后，失败态 / 空态 / 上拉重试的规则只需要对一次。
 *
 * 🚨 两条硬约束：
 *  1. 分页参数是 `current`（不是 `page`），传错会被后端静默忽略、恒返回第 1 页；
 *  2. **请求失败 ≠ 结果为空**：失败时 `failed=true`，由页面渲染 ErrorState，
 *     绝不能让它掉进 EmptyState（那等于把「服务器挂了」说成「这里本来就没内容」）。
 *
 * @param {(p:{current:number,size:number}) => Promise<any>} fetcher 返回 PageResult 的取数函数
 * @param {{pageSize?:number, unit?:string}} [opt]
 */
import { ref, computed } from 'vue'

export function usePagedList(fetcher, opt = {}) {
  const pageSize = opt.pageSize || 10
  const unit = opt.unit || '条'

  const list = ref([])
  const loading = ref(true)
  const current = ref(1)
  const total = ref(0)
  const noMore = ref(false)
  const failed = ref(false) // 首屏 / 下拉刷新失败
  const moreFailed = ref(false) // 上拉那一页失败

  const footerText = computed(() => {
    if (moreFailed.value) return '加载失败，点此重试'
    if (noMore.value) return `已加载全部 ${total.value} ${unit}`
    return '上拉加载更多'
  })

  /**
   * @param {boolean} reset true=从第 1 页重取（首屏 / 切排序 / 下拉刷新）
   */
  async function load(reset = false) {
    if (reset) {
      current.value = 1
      noMore.value = false
      failed.value = false
      moreFailed.value = false
    }
    loading.value = reset
    try {
      const res = await fetcher({ current: current.value, size: pageSize })
      const records = (res && res.records) || []
      total.value = (res && res.total) || 0
      list.value = reset ? records : list.value.concat(records)
      moreFailed.value = false
      if (list.value.length >= total.value || !records.length) noMore.value = true
    } catch (e) {
      if (reset) {
        list.value = []
        failed.value = true
      } else {
        // 页码回退，否则重试会直接跳过这一页
        current.value = Math.max(1, current.value - 1)
        moreFailed.value = true
      }
    } finally {
      loading.value = false
    }
  }

  /** 首屏 / 筛选变化 / 下拉刷新 */
  const reload = () => load(true)

  /** 触底加载下一页（上一页失败时不自动重试，避免在触底处疯狂重连） */
  function loadMore() {
    if (noMore.value || loading.value || moreFailed.value) return
    current.value += 1
    load(false)
  }

  /** 点底部「加载失败，点此重试」 */
  function retryMore() {
    if (!moreFailed.value) return
    current.value += 1
    moreFailed.value = false
    load(false)
  }

  return { list, loading, current, total, noMore, failed, moreFailed, footerText, load, reload, loadMore, retryMore }
}
