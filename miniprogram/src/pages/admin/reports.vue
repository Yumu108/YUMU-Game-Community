<template>
  <view class="rpt">
    <!--
      没有后台身份时的兜底（2026-09-26）。
      🚨 H5 是 **hash 路由**，手敲 /m/#/pages/admin/reports 谁都能进 ——
         端内跳转不是安全边界。后端会 403，但直接弹红字很难看，还会白挨一次请求。
         所以先用本地角色判一次（`canManageReports` = ADMIN 或 MODERATOR），
         不合格就只渲染说明、**一个请求都不发**。
      🚨 注意这里的判据与 `pages/admin/users.vue` **不同**：
         那边只认 ADMIN（`AdminUserController` 类级 hasRole('ADMIN')），
         这边 ADMIN 与 MODERATOR 都放行（`/admin/reports` 在 hasAnyRole('ADMIN','MODERATOR') 的类下）。
    -->
    <view v-if="!allowed" class="rpt-deny">
      <text class="rpt-deny__t">仅管理员与版主可访问</text>
      <text class="rpt-deny__d">
        举报队列属于审核后台能力（后端 AdminController 上是类级 @PreAuthorize("hasAnyRole('ADMIN','MODERATOR')")）。普通用户可在「我的 → 我的举报」查看自己提交的举报进度。
      </text>
      <view class="rpt-deny__btn" @click="back">返回</view>
    </view>

    <template v-else>
      <!--
        作用域说明条 —— 这条文案是**本页最重要的一句话**：
        管理员和版主看到的是同一个界面，但拿到的数据集合完全不同（后端按游戏切）。
        不写清楚的话，版主会以为「社区一共就这么几条举报」。
      -->
      <view class="rpt-tip">
        <text class="rpt-tip__t">{{ scopeTitle }}</text>
        <text class="rpt-tip__d">{{ scopeDesc }}</text>
      </view>

      <!--
        状态筛选。默认停在「待处理」—— 审核队列的第一诉求是「还有什么要我处理」，
        进来先看一堆已结案的历史没有意义。
        `status` 传 null 表示不筛状态（后端 `Report.status` 为 null 时不加过滤条件）。
      -->
      <view class="rpt-tabs">
        <view
          v-for="t in TABS"
          :key="String(t.value)"
          class="rpt-tab"
          :class="{ 'rpt-tab--on': tab === t.value }"
          @click="switchTab(t.value)"
        >
          <text class="rpt-tab__txt">{{ t.label }}</text>
          <text v-if="t.value === 0 && pendingCount > 0" class="rpt-tab__badge">{{ pendingCount }}</text>
        </view>
      </view>

      <view v-if="loading && !list.length" class="rpt-st">加载中…</view>
      <view v-else-if="failed" class="rpt-st rpt-st--err" @click="load(1)">加载失败，点此重试</view>
      <view v-else-if="!list.length" class="rpt-st">
        {{ tab === 0 ? '这个分类下暂无待处理举报 🎉' : '这个分类下暂无举报' }}
      </view>

      <template v-else>
        <view class="rpt-list">
          <view v-for="r in list" :key="r.id" class="rpt-item" @click="openSheet(r)">
            <view class="rpt-item__head">
              <text class="rpt-type">{{ typeText(r) }}</text>
              <text class="rpt-status" :class="'rpt-status--' + statusTone(r.status)">
                {{ statusText(r.status) }}
              </text>
              <text class="rpt-item__id">#{{ r.id }}</text>
            </view>

            <text class="rpt-reason">{{ r.reason }}</text>

            <!-- 被举报对象：帖子标题 / 回复摘要 / 用户名（后端已组装好 targetTitle） -->
            <text class="rpt-target">{{ r.targetTitle }}</text>

            <!--
              归属信息。版主最需要这一行 —— 「这条归不归我管」一眼可辨。
              🚨 后端只在能定位到目标帖子时才回填 gameId/gameName（用户举报、目标已删则全为 null），
                 所以这里用 `v-if` 兜底一句「无法定位」，而不是显示空白。
            -->
            <text v-if="locText(r)" class="rpt-scope">{{ locText(r) }}</text>
            <text v-else class="rpt-scope rpt-scope--warn">无法定位目标归属</text>

            <view class="rpt-item__foot">
              <text class="rpt-meta">{{ r.reporterName }} 举报 · {{ timeText(r.createdAt) }}</text>
              <text
                class="rpt-act"
                :class="{ 'rpt-act--off': !canHandle(r) }"
              >{{ canHandle(r) ? '处理 ›' : '不可处理' }}</text>
            </view>
          </view>
        </view>

        <view v-if="hasMore" class="rpt-more" @click="load(current + 1)">
          加载更多（{{ list.length }} / {{ total }}）
        </view>
        <text v-else class="rpt-total">共 {{ total }} 条</text>
      </template>
    </template>

    <!--
      处理面板。
      🚨 遮罩必须是**独立兄弟节点**，不能用 `@click.self` ——
         uni-app 编译到 mp-weixin 时 `.self` 修饰符会被静默丢弃（H5 正常），
         「点遮罩关闭」在小程序端会失效。这个坑本项目已踩过（见 pages/admin/users.vue）。
    -->
    <view v-if="sheet" class="rpt-sh">
      <view class="rpt-sh__mask" @click="closeSheet"></view>
      <view class="rpt-sh__panel">
        <view class="rpt-sh__head">
          <text class="rpt-sh__title">{{ cur && cur.status === 0 ? '处理举报' : '举报详情' }}</text>
          <text class="rpt-sh__close" @click="closeSheet">✕</text>
        </view>

        <scroll-view class="rpt-sh__body" scroll-y>
          <view v-if="cur" class="rpt-detail">
            <view class="rpt-detail__row">
              <text class="rpt-detail__k">举报对象</text>
              <text class="rpt-detail__v">{{ typeText(cur) }}</text>
            </view>
            <view class="rpt-detail__row">
              <text class="rpt-detail__k">归属</text>
              <text class="rpt-detail__v">{{ locText(cur) || '无法定位（目标可能已被删除）' }}</text>
            </view>
            <view class="rpt-detail__row">
              <text class="rpt-detail__k">举报人</text>
              <text class="rpt-detail__v">{{ cur.reporterName }}</text>
            </view>
            <view class="rpt-detail__row">
              <text class="rpt-detail__k">时间</text>
              <text class="rpt-detail__v">{{ timeText(cur.createdAt) }}</text>
            </view>

            <text class="rpt-detail__label">举报理由</text>
            <text class="rpt-detail__text">{{ cur.reason }}</text>

            <text class="rpt-detail__label">被举报内容</text>
            <text class="rpt-detail__text">{{ cur.targetTitle }}</text>

            <!-- 已结案的：把处理结论摆出来（这是「举报闭环」的证据，端内也能看到） -->
            <template v-if="cur.status !== 0">
              <text class="rpt-detail__label">处理结果</text>
              <text class="rpt-detail__text">
                {{ statusText(cur.status) }}{{ cur.handleNote ? ' · 备注：' + cur.handleNote : '' }}
              </text>
            </template>

            <!-- 处理备注（可选）：会写进 report.handle_note，主站的举报队列同样能看到 -->
            <template v-if="cur.status === 0 && canHandle(cur)">
              <text class="rpt-detail__label">处理备注（可选）</text>
              <textarea
                v-model="note"
                class="rpt-note"
                placeholder="写清判断依据，便于复盘与申诉"
                placeholder-class="rpt-ph"
                maxlength="200"
              />
            </template>
          </view>
        </scroll-view>

        <!--
          动作区。三种情形分开渲染，别用同一套按钮加 disabled：
            · 无权处理（用户举报 / 目标已删 / 不在辖区）→ 只给一句原因 + 关闭
            · 已结案                                      → 只给关闭
            · 待处理且有权                                → 两段式：选动作 → 就地确认

          🚨 **为什么是「就地确认」而不是 `uni.showModal`（本页踩过，记在这里）**：
             最初用 `uni.showModal` 弹二次确认，结果确认框**被压在底部面板下面** ——
             uni-app H5 的 modal 层 `z-index` 只有 999，而本面板是 1500
             （必须高于详情页管理面板 1300 与用户权限面板 1400，见 `.rpt-sh`）。
             后果：用户点「驳回」→ 弹框在面板底下，**看起来像点了没反应**，
             而且点不到、也关不掉（遮罩同样在下面）。
             回归脚本在 PM73 上直接卡 30s 超时（Playwright 报
             「element is visible…but 被 .rpt-detail__label 拦截指针事件」）——
             报错说的是「被页面元素挡住」，很容易误判成选择器写错，
             真因是**层级**。
             ⇒ 结论：面板内的二次确认**就地渲染**，不要跨层调用系统弹窗。
               好处还有两个：文案能跟着动作变（见 `confirmText`），
               且不再依赖 uni 的弹窗实现（换端不用改测试）。
        -->
        <template v-if="cur && cur.status === 0 && canHandle(cur)">
          <view v-if="!pendingAction" class="rpt-sh__btns">
            <view class="rpt-btn" :class="{ 'rpt-btn--off': busy }" @click="askHandle(2)">驳回</view>
            <view class="rpt-btn rpt-btn--danger" :class="{ 'rpt-btn--off': busy }" @click="askHandle(1)">
              标记违规
            </view>
          </view>

          <view v-else class="rpt-confirm">
            <text class="rpt-confirm__t">{{ confirmText }}</text>
            <view class="rpt-confirm__btns">
              <view class="rpt-btn" @click="pendingAction = null">取消</view>
              <view
                class="rpt-btn rpt-btn--danger rpt-confirm__go"
                :class="{ 'rpt-btn--off': busy }"
                @click="submit(pendingAction)"
              >{{ busy ? '处理中…' : (pendingAction === 1 ? '确认标记违规' : '确认驳回') }}</view>
            </view>
          </view>
        </template>
        <view v-else-if="cur" class="rpt-sh__foot">
          <text class="rpt-sh__why">{{ cur.status === 0 ? reportBlockReason(user, cur) : '该举报已结案' }}</text>
          <view class="rpt-btn rpt-btn--wide" @click="closeSheet">知道了</view>
        </view>

        <text v-if="cur && cur.status === 0 && canHandle(cur) && !pendingAction" class="rpt-sh__hint">
          「标记违规」会同时隐藏被举报的{{ cur.targetType === 2 ? '回复' : '帖子' }}并同步计数，不可撤销；「驳回」只结案、内容保持原样。点按钮后会再确认一次。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 举报处理队列（2026-09-26 新增）—— 管理员看全站，版主只看自己负责的游戏。
 *
 * ══════════════════ 这个页面为什么存在 ══════════════════
 * 上一版权限矩阵把「处理举报」标成「主站」并给了一句理由：
 * 「要先看举报列表与证据，适合宽屏处理」。用户随后的要求是把它搬进端内，
 * 且明确了两条作用域规则：
 *   · 管理员 → 能看到**所有**举报并处理
 *   · 版主   → 只能看到**自己负责游戏板块**的举报并处理
 * 这两条规则**全部由后端实现**（`AdminController#listReports` +
 * `canModerateReportTarget`），端内只是同一个接口的另一套交互。
 *
 * ══════════════════ 后端：一处真 bug + 一处补字段 ══════════════════
 * ① 🚨 **版主举报队列恒为空**（本轮修）：`listReports` 原先传的是
 *    `listBoardIdsByUserId(...)`，但授权早已改成游戏级（`moderator_board.board_id`
 *    恒为 NULL）⇒ 那个方法对 board_id 列做 `distinct().sorted()` 得到 `[null]`，
 *    SQL 生成 `p.board_id IN (null)` **恒不命中**。接口 200、不报错、只是没数据 ——
 *    这种「静默返回空」的故障主站上也一直存在，是做这个页面时才暴露的。
 *    改为按 `game_id` 过滤（见 `ReportMapper#selectReportPage`）。
 * ② `ReportVO` 补了 `gameId/gameName/boardId/boardName`：端内要能回答
 *    「这条举报归不归我管」，光有标题不够。
 *
 * ══════════════════ 三条容易踩的线 ══════════════════
 * ① 入口闸门用 `canManageReports`（**含版主**），别抄 users.vue 的 `canManageUsers`。
 * ② 作用域**不在前端二次过滤**：后端已按角色切好，端内再筛一遍就是「两处各判一次」，
 *    改一处必漂移。端内只负责把「点了必然失败」的按钮置灰（`canHandleReport`）。
 * ③ 处理动作**不做乐观更新**（与点赞/收藏同一条铁律）：成功与否只看服务端响应，
 *    成功后重新拉当前页 —— 因为「标记违规」的副作用（隐藏目标、同步计数、
 *    失效热门榜缓存）只有后端知道最终态。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getUser } from '../../utils/store'
import { formatTime } from '../../utils/format'
import { canManageReports, canHandleReport, reportBlockReason } from '../../utils/roles'
import { fetchAdminReports, handleAdminReport, REPORT_STATUS_LABEL, REPORT_TYPE_LABEL } from '../../api/admin'

/**
 * 筛选项。`value` 直接对应后端 `Report.status`；
 * `null` = 不筛（后端 `status == null` 时不拼 `AND status = ?`）。
 * 顺序按「审核员的关注度」排，待处理放第一个且是默认项。
 */
const TABS = [
  { label: '待处理', value: 0 },
  { label: '已处理', value: 1 },
  { label: '已驳回', value: 2 },
  { label: '全部', value: null }
]

const allowed = ref(false)
const user = ref({})

const tab = ref(0)
const list = ref([])
const total = ref(0)
const current = ref(1)
const loading = ref(false)
const failed = ref(false)

/** 待处理数量（用于在「待处理」页签上挂个角标。只在待处理页签下由列表长度推出，非全站计数） */
const pendingCount = computed(() => (tab.value === 0 ? total.value : 0))

const hasMore = computed(() => list.value.length < (total.value || 0))

/* ---------------- 处理面板 ---------------- */
const sheet = ref(false)
const cur = ref(null)
const note = ref('')
const busy = ref(false)
/**
 * 二次确认中的动作（null = 还没选；1 = 待确认「标记违规」；2 = 待确认「驳回」）。
 * 与 `busy` 分开：`busy` 是「请求进行中」，`pendingAction` 是「等你再点一下确认」。
 * 混成一个状态会出现「请求还没发就被当成确认中」这类时序 bug。
 */
const pendingAction = ref(null)

/**
 * 是否管理员。
 * ⚠️ 定义必须排在下面几个 computed **之前** —— Vue 的 computed getter 虽然是惰性求值
 *    （首帧渲染时才跑，那时 const 已初始化，不会踩 TDZ），但把被依赖的声明放在
 *    使用它的表达式后面，读代码的人得来回跳。声明顺序与依赖方向一致是硬要求。
 */
const isAdmin = computed(() => ((user.value && user.value.roles) || []).includes('ADMIN'))

/**
 * 角色化的作用域文案 —— 同一句话在管理员/版主眼里含义完全不同，
 * 所以不能写成一句静态文案（那会让版主以为自己看到的是全站数据）。
 */
const scopeTitle = computed(() => {
  if (isAdmin.value) return '全站举报队列'
  const games = (user.value && user.value.moderatorGameNames) || []
  return games.length ? `仅你负责的《${games.join('、')}》` : '你暂未负责任何游戏'
})
const scopeDesc = computed(() => {
  if (isAdmin.value) {
    return '管理员可见全部举报；「标记违规」会同时隐藏被举报的帖子或回复。'
  }
  if (!((user.value && user.value.moderatorGameNames) || []).length) {
    return '版主只看得到自己负责游戏下的举报，因此这里不会有数据。请联系管理员分配负责游戏。'
  }
  return '版主只看得到自己负责游戏下的举报（后端按游戏切分）；「举报用户」这类举报仅管理员可处理。'
})

/** 目标类型文案：1帖子 2回复 3用户（未知类型如实退化成「举报」） */
function typeText(r) {
  const t = r && r.targetType
  const label = REPORT_TYPE_LABEL[t]
  return label ? `${label}举报` : '举报'
}
function statusText(s) {
  return REPORT_STATUS_LABEL[s] ?? '未知'
}
/** 状态 → 配色词（与后端 status 常量对齐：0 待处理 / 1 违规 / 2 驳回） */
function statusTone(s) {
  if (s === 0) return 'pending'
  if (s === 1) return 'resolved'
  if (s === 2) return 'rejected'
  return 'pending'
}
/** 归属行：「《游戏名》· 板块名」——任一段缺失就退化显示另一段 */
function locText(r) {
  if (!r || r.gameId == null) return ''
  const g = r.gameName || `游戏#${r.gameId}`
  return r.boardName ? `《${g}》· ${r.boardName}` : `《${g}》`
}
function timeText(t) {
  return formatTime(t) || ''
}

/** 当前用户能不能处理这一条（纯函数，规则与后端 canModerateReportTarget 对齐） */
function canHandle(r) {
  return canHandleReport(user.value, r)
}

/**
 * 拉取列表。
 * @param {number} page 页码（1 = 重新加载当前筛选）
 * ⚠️ 失败**不清空**已有数据：翻页时网络抖一下就把整屏清掉，比留着旧数据差得多。
 */
async function load(page = 1) {
  if (loading.value) return
  loading.value = true
  failed.value = false
  try {
    const r = (await fetchAdminReports({ status: tab.value, current: page, size: 20 })) || {}
    const recs = r.records || []
    if (page === 1) list.value = recs
    else list.value = list.value.concat(recs)
    total.value = r.total || 0
    current.value = page
  } catch (e) {
    failed.value = list.value.length === 0
  } finally {
    loading.value = false
  }
}

/** 切筛选：清空列表再拉，避免上一分类的数据短暂混在新分类里 */
function switchTab(v) {
  if (tab.value === v) return
  tab.value = v
  list.value = []
  total.value = 0
  load(1)
}

/**
 * 二次确认的提示语 —— **两种结果的后果完全不同，必须各说各的**。
 * 笼统一句「确定吗」等于没确认：审核员最需要知道的是「会不会连带隐藏内容」。
 */
const confirmText = computed(() => {
  if (!pendingAction.value) return ''
  if (pendingAction.value === 1) {
    const what = cur.value && cur.value.targetType === 2 ? '回复' : '帖子'
    return `确认标记为违规？将同时隐藏被举报的${what}、同步板块计数与热门榜，此操作不可撤销。`
  }
  return '确认驳回？仅把这条举报结案，被举报的内容保持原样、仍然公开。'
})

function openSheet(r) {
  cur.value = r
  note.value = ''
  busy.value = false
  pendingAction.value = null
  sheet.value = true
}
function closeSheet() {
  sheet.value = false
  cur.value = null
  note.value = ''
  busy.value = false
  pendingAction.value = null
}

/**
 * 第一步：选中动作，进入「待确认」态（**不**直接提交）。
 *
 * 🚨 不在这里调 `uni.showModal` —— 理由见模板里那段注释（modal 会被本面板压住，
 *    用户看得到点了没反应）。确认框就地渲染在面板内。
 */
function askHandle(status) {
  if (!cur.value || busy.value) return
  pendingAction.value = status
}

/**
 * 第二步：真正提交。
 *
 * 🚨 不做乐观更新：不预先改本地 `status`，只等接口返回成功后重新拉列表 ——
 *    「标记违规」的副作用（隐藏目标、同步板块计数、失效热门榜缓存）只有后端知道最终态。
 * ⚠️ 失败时不关面板：请求层会把后端原文 toast 出来（例如「该举报已处理，不能重复处理」），
 *    留着面板用户才能看到自己填的备注并重试。
 */
async function submit(status) {
  if (!cur.value || busy.value) return
  busy.value = true
  try {
    await handleAdminReport(cur.value.id, status, note.value.trim())
    uni.showToast({
      title: status === 1 ? '已标记违规并隐藏' : '已驳回',
      icon: 'none',
      duration: 1800
    })
    sheet.value = false
    cur.value = null
    note.value = ''
    pendingAction.value = null
    // 重新拉当前页 —— 待处理列表会少一条，已处理/全部列表该条状态会刷新
    await load(current.value)
  } catch (e) {
    /* 失败文案由请求层 toast 后端原文；本地状态保持不变 */
  } finally {
    busy.value = false
  }
}

function back() {
  uni.navigateBack()
}

/**
 * 进页面先做本地角色闸门（理由见模板顶部）。
 * 只有确认是 ADMIN / MODERATOR 才发第一个请求，否则普通用户会白挨一次 403 红字。
 */
onLoad(() => {
  const me = getUser() || {}
  user.value = me
  allowed.value = canManageReports(me.roles || [])
  if (allowed.value) load(1)
})
</script>

<!--
  ⚠️ 这一块**故意不加 scoped**：`placeholder-class` 指定的类会被加到 uni-app 运行时
  动态创建的占位元素上，那个元素不带 Vue 的 scoped 属性（`data-v-xxx`），
  scoped 选择器（编译成 `.rpt-ph[data-v-xxx]`）根本匹配不到 —— 占位文字会退回浏览器
  默认色，在深色底上几乎看不见。同 pages/admin/users.vue 的处理。
-->
<style>
.rpt-ph {
  color: #6f6982;
  font-size: 24rpx;
}
</style>

<style scoped>
.rpt {
  min-height: 100vh;
  padding: 20rpx 24rpx calc(40rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

/* ---------------- 无权访问 ---------------- */
.rpt-deny {
  margin-top: 120rpx;
  padding: 40rpx 32rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.rpt-deny__t {
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.rpt-deny__d {
  margin-top: 16rpx;
  font-size: 23rpx;
  line-height: 1.7;
  color: #8b8599;
}
.rpt-deny__btn {
  margin-top: 32rpx;
  padding: 14rpx 48rpx;
  border-radius: 999rpx;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-size: 25rpx;
}

/* ---------------- 作用域说明 ---------------- */
.rpt-tip {
  display: flex;
  flex-direction: column;
  padding: 22rpx 24rpx;
  background: rgba(124, 92, 255, 0.1);
  border: 1rpx solid rgba(124, 92, 255, 0.26);
  border-radius: 20rpx;
}
.rpt-tip__t {
  font-size: 26rpx;
  font-weight: 600;
  color: #cbbdff;
}
.rpt-tip__d {
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.7;
  color: #a49eb6;
}

/* ---------------- 状态筛选 ---------------- */
.rpt-tabs {
  display: flex;
  margin-top: 20rpx;
  padding: 6rpx;
  background: #231f31;
  border: 1rpx solid #2a2538;
  border-radius: 18rpx;
}
.rpt-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 68rpx;
  border-radius: 14rpx;
}
.rpt-tab--on {
  background: #7c5cff;
}
.rpt-tab__txt {
  font-size: 24rpx;
  color: #a49eb6;
}
.rpt-tab--on .rpt-tab__txt {
  color: #fff;
  font-weight: 600;
}
.rpt-tab__badge {
  margin-left: 6rpx;
  min-width: 30rpx;
  padding: 0 6rpx;
  height: 30rpx;
  line-height: 30rpx;
  text-align: center;
  border-radius: 999rpx;
  background: #ff6b6b;
  color: #fff;
  font-size: 18rpx;
}

/* ---------------- 状态提示 ---------------- */
.rpt-st {
  margin-top: 28rpx;
  padding: 48rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: #6f6982;
}
.rpt-st--err {
  color: #f0b45f;
}

/* ---------------- 举报条目 ---------------- */
.rpt-list {
  margin-top: 20rpx;
}
.rpt-item {
  padding: 22rpx 24rpx;
  margin-bottom: 14rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 20rpx;
}
.rpt-item__head {
  display: flex;
  align-items: center;
}
.rpt-type {
  flex: none;
  padding: 1rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(124, 92, 255, 0.16);
  color: #a894ff;
  font-size: 19rpx;
}
.rpt-status {
  flex: none;
  margin-left: 8rpx;
  padding: 1rpx 12rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
}
.rpt-status--pending {
  background: rgba(240, 180, 95, 0.16);
  color: #f0b45f;
}
.rpt-status--resolved {
  background: rgba(93, 202, 165, 0.16);
  color: #5dcaa5;
}
.rpt-status--rejected {
  background: rgba(255, 255, 255, 0.06);
  color: #8b8599;
}
.rpt-item__id {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 19rpx;
  color: #5f5a72;
}
.rpt-reason {
  display: block;
  margin-top: 14rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: #e9e7f2;
}
.rpt-target {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: #8b8599;
}
.rpt-scope {
  display: block;
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #5dcaa5;
}
.rpt-scope--warn {
  color: #f0b45f;
}
.rpt-item__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14rpx;
}
.rpt-meta {
  font-size: 20rpx;
  color: #6f6982;
}
.rpt-act {
  font-size: 22rpx;
  color: #8f7bff;
}
.rpt-act--off {
  color: #5f5a72;
}

.rpt-more {
  padding: 24rpx 0;
  text-align: center;
  font-size: 23rpx;
  color: #8f7bff;
}
.rpt-total {
  display: block;
  margin-top: 12rpx;
  text-align: center;
  font-size: 21rpx;
  color: #6f6982;
}

/* ---------------- 处理面板 ---------------- */
.rpt-sh {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  /* 高于详情页管理面板（1300）与用户权限面板（1400），留层级余量 */
  z-index: 1500;
}
.rpt-sh__mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
}
.rpt-sh__panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
  background: #1a1725;
  border-top: 1rpx solid #2a2538;
  border-radius: 28rpx 28rpx 0 0;
  box-sizing: border-box;
}
.rpt-sh__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rpt-sh__title {
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.rpt-sh__close {
  padding: 0 8rpx;
  font-size: 28rpx;
  color: #6f6982;
}
.rpt-sh__body {
  flex: 1;
  min-height: 0;
  max-height: 56vh;
}
.rpt-detail {
  display: flex;
  flex-direction: column;
  padding-bottom: 10rpx;
}
.rpt-detail__row {
  display: flex;
  align-items: flex-start;
  margin-top: 16rpx;
}
.rpt-detail__k {
  flex: none;
  width: 128rpx;
  font-size: 22rpx;
  color: #6f6982;
}
.rpt-detail__v {
  flex: 1;
  min-width: 0;
  font-size: 22rpx;
  line-height: 1.55;
  color: #cbbdff;
}
.rpt-detail__label {
  display: block;
  margin-top: 24rpx;
  font-size: 22rpx;
  color: #6f6982;
}
.rpt-detail__text {
  display: block;
  margin-top: 8rpx;
  padding: 16rpx 20rpx;
  background: #221d33;
  border: 1rpx solid #2a2538;
  border-radius: 16rpx;
  font-size: 24rpx;
  line-height: 1.65;
  color: #e9e7f2;
}
.rpt-note {
  width: 100%;
  height: 150rpx;
  margin-top: 8rpx;
  padding: 16rpx 20rpx;
  box-sizing: border-box;
  background: #231f31;
  border: 1rpx solid #2a2538;
  border-radius: 16rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #e9e7f2;
}

/* ---------------- 动作区 ---------------- */
.rpt-sh__btns {
  display: flex;
  margin-top: 28rpx;
}
.rpt-btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  border-radius: 16rpx;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-size: 27rpx;
}
.rpt-btn--danger {
  margin-left: 18rpx;
  background: #e5484d;
  border-color: #e5484d;
  color: #fff;
  font-weight: 600;
}
.rpt-btn--wide {
  width: 100%;
  margin-top: 20rpx;
}
/* 请求进行中降透明度（不禁用点击 —— 交给 `busy` 早退，避免出现「点了毫无反应」） */
.rpt-btn--off {
  opacity: 0.5;
}
.rpt-sh__foot {
  margin-top: 28rpx;
}
.rpt-sh__why {
  display: block;
  font-size: 22rpx;
  line-height: 1.6;
  color: #f0b45f;
}
/* 就地二次确认：警告底 + 两按钮。层级留在面板内，不跨层弹窗（理由见模板注释） */
.rpt-confirm {
  margin-top: 28rpx;
  padding: 18rpx 20rpx;
  background: rgba(229, 72, 77, 0.1);
  border: 1rpx solid rgba(229, 72, 77, 0.32);
  border-radius: 16rpx;
}
.rpt-confirm__t {
  display: block;
  font-size: 22rpx;
  line-height: 1.7;
  color: #ff9a9d;
}
.rpt-confirm__btns {
  display: flex;
  margin-top: 18rpx;
}
.rpt-sh__hint {
  display: block;
  margin-top: 18rpx;
  font-size: 19rpx;
  line-height: 1.7;
  color: #5f5a72;
}
</style>
