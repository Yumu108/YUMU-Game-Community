// 公告弹窗逻辑 验证（每日一次 + 新公告触达）
// 用法：node tests/announcement-daily-verify.mjs
//
// 说明：弹窗与否是纯前端 localStorage 判断，无法用接口测试覆盖。
// 本脚本镜像 Home.vue 中的核心判断逻辑，验证两条触发规则与隔离性：
//   ① 当天首次进入（无记录）→ 弹出
//   ② 关闭后再进入 → 不再弹出
//   ③ 自然日翻篇（第二天）→ 再次弹出
//   ④ 换一个用户 → 各自独立（互不影响）
//   ⑤ 没有公告 → 不弹
//   ⑥ force（手动「再看一次」）→ 即使当天已弹过也弹
//   ⑦ 当天已弹过，但运营发了新公告 → 再弹一次（新公告触达）
//   ⑧ 看完新公告再关闭 → 该公告不再重复弹
//   ⑨ 置顶的老公告排在首位时，仍能靠 max(id) 正确识别新公告

let pass = 0, fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗ FAIL:', msg) }
}

// ---------- 模拟浏览器环境 ----------
class MemStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}
const localStorage = new MemStorage()

// 可推进的「当前时间」，用于模拟跨天
let mockNow = new Date(2026, 8, 1, 10, 0, 0) // 2026-09-01 10:00
let currentUid = null // null = 未登录游客

// ---------- 镜像 Home.vue 的逻辑 ----------
const ANNO_KEY_PREFIX = 'yumu_anno_daily_v3_'

function annoKey() {
  const uid = currentUid
  return ANNO_KEY_PREFIX + (uid != null ? uid : 'guest')
}
function todayStr() {
  const d = mockNow
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
/** 最新发布的公告 id = max(id)（后端按 sort DESC, id DESC，items[0] 未必是最新） */
function latestAnnouncementId(list) {
  return (list || []).reduce((max, a) => (a.id > max ? a.id : max), 0)
}
function readAnnoSeen() {
  try {
    return JSON.parse(localStorage.getItem(annoKey()) || '{}') || {}
  } catch (e) {
    return {}
  }
}
function hasShownToday() {
  const seen = readAnnoSeen()
  return !!seen.date && seen.date === todayStr()
}
function hasNewAnnouncement(list) {
  const seenMaxId = Number(readAnnoSeen().seenMaxId) || 0
  return latestAnnouncementId(list) > seenMaxId
}
function shouldPopup(announcements, force = false) {
  if (!announcements || !announcements.length) return false
  if (force) return true
  const daily = !hasShownToday()
  const fresh = hasNewAnnouncement(announcements)
  return daily || fresh
}
function onAnnoClose(announcements) {
  try {
    localStorage.setItem(annoKey(), JSON.stringify({
      date: todayStr(),
      seenMaxId: latestAnnouncementId(announcements),
      at: Date.now()
    }))
  } catch (e) { /* localStorage 不可用时静默 */ }
}

// ---------- 用例 ----------
const ANNO = [{ id: 8, title: 'hello' }, { id: 3, title: '1的测试' }]

console.log('═══ 公告弹窗逻辑 验证（每日一次 + 新公告触达）═══\n')

// ① 当天首次进入，无记录 → 应弹出
console.log('[1] 2026-09-01 首次进入（用户 555）')
currentUid = 555
assert(shouldPopup(ANNO) === true, '无记录 → 弹出')
onAnnoClose(ANNO)
console.log(`     记录: ${localStorage.getItem('yumu_anno_daily_v3_555')}`)

// ② 当天再次进入 → 不应弹出
console.log('\n[2] 同一天再次进入（刷新/换页再回首页）')
assert(shouldPopup(ANNO) === false, '当天已弹过且无新公告 → 不再弹出')
assert(shouldPopup(ANNO) === false, '当天第三次进入 → 仍不弹')

// ⑦ 当天已弹过，但运营发了新公告 → 应再弹
console.log('\n[7] 当天已弹过，运营发布新公告（id=21）')
const WITH_NEW = [{ id: 21, title: '91快乐' }, ...ANNO]
assert(shouldPopup(WITH_NEW) === true, '存在比 seenMaxId=8 更新的公告 → 再弹一次')
onAnnoClose(WITH_NEW)
assert(shouldPopup(WITH_NEW) === false, '看完新公告并关闭后 → 该公告不再重复弹')

// ⑨ 置顶的老公告排在首位，仍能靠 max(id) 识别新公告
console.log('\n[9] 置顶老公告排首位（sort DESC 导致 items[0] 是老公告）')
const PINNED_OLD_FIRST = [{ id: 3, title: '被置顶的老公告' }, { id: 21, title: '91快乐' }]
assert(PINNED_OLD_FIRST[0].id === 3, 'items[0] 确实是老公告 id=3（模拟后端 sort DESC）')
assert(latestAnnouncementId(PINNED_OLD_FIRST) === 21, 'max(id) 正确识别最新公告 = 21')
assert(shouldPopup(PINNED_OLD_FIRST) === false, 'seenMaxId 已是 21 → 不重复弹')
// 再来一条更新公告（id=22），即使它不在首位也应触发
const WITH_NEWER = [{ id: 3, title: '被置顶的老公告' }, { id: 22, title: '更新公告' }]
assert(shouldPopup(WITH_NEWER) === true, '新公告 id=22 不在首位，仍能被 max(id) 识别 → 弹出')
onAnnoClose(WITH_NEWER)

// ③ 自然日翻篇 → 应再次弹出
console.log('\n[3] 跨到第二天 2026-09-02 首次进入')
mockNow = new Date(2026, 8, 2, 9, 0, 0)
assert(todayStr() === '2026-09-02', `todayStr 已翻篇 → ${todayStr()}`)
assert(shouldPopup(WITH_NEWER) === true, '新的一天 → 再次弹出')
onAnnoClose(WITH_NEWER)
assert(shouldPopup(WITH_NEWER) === false, '关闭后当天 → 不再弹')

// 继续跨第三天
mockNow = new Date(2026, 8, 3, 8, 30, 0)
assert(shouldPopup(WITH_NEWER) === true, '第三天首次进入 → 再次弹出（逐日类推）')
onAnnoClose(WITH_NEWER)

// ④ 用户隔离
console.log('\n[4] 换用户（同一天 2026-09-03，用户 555 已弹过）')
currentUid = 777
assert(shouldPopup(WITH_NEWER) === true, '新用户 777 → 自己的记录为空，应弹出')
onAnnoClose(WITH_NEWER)
assert(shouldPopup(WITH_NEWER) === false, '用户 777 当天再进入 → 不弹')
currentUid = 555
assert(shouldPopup(WITH_NEWER) === false, '切回用户 555 → 仍是已弹过，不弹（数据隔离正确）')
currentUid = 777

// ⑤ 游客场景
console.log('\n[5] 未登录游客')
currentUid = null
assert(shouldPopup(WITH_NEWER) === true, '游客首次进入 → 弹出')
onAnnoClose(WITH_NEWER)
assert(shouldPopup(WITH_NEWER) === false, '游客当天再进入 → 不弹')

// ⑥ 无公告
console.log('\n[6] 后端无公告')
assert(shouldPopup([]) === false, '空公告列表 → 不弹窗')
assert(shouldPopup(null) === false, 'null → 不弹窗')

// ⑦ force 强制查看
console.log('\n[7b] force 手动「再看一次」')
currentUid = 555
assert(shouldPopup(WITH_NEWER, true) === true, 'force=true 即使当天已弹过也弹')

// ⑧ 记录损坏容错
console.log('\n[8] localStorage 记录损坏')
localStorage.setItem('yumu_anno_daily_v3_555', '{bad json')
assert(shouldPopup(WITH_NEWER) === true, '损坏记录 → 按「没弹过」处理，保证公告触达')

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail === 0 ? 0 : 1)
