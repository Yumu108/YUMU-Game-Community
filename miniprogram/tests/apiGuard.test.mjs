/**
 * 接口守卫单元测试（22 项）—— 2026-09-20 真机「平台分类全 0」事故的回归。
 *
 * 运行：
 *   cd miniprogram
 *   node --experimental-default-type=module tests/apiGuard.test.mjs
 *
 * 为什么能直接 import：`src/utils/apiGuard.js` **零 import**（刻意设计，理由同 guideQuery.js）。
 *
 * 🚨 这批断言锁的是**事故链上每一个「读法」**，而不是最终的 UI 现象：
 *   1) 请求侧：`undefined` 必须被清掉（否则会被序列化成字符串 "undefined" 变成真筛选）；
 *   2) 响应侧：`{code:200, data:{records:[], total:0}}` 这种**空成功**必须被判为不可缓存；
 *   3) 缓存侧：`map:{}` 的历史坏缓存必须被判废（否则设备一坏就是一整天、自愈不了）。
 *   只断 UI 是断不出这些的 —— 线上那次 UI 上只表现为「数字是 0」。
 */
import {
  cleanParams,
  isPagedBody,
  foldGameRecords,
  isUsableMeta,
  isUsableIndex,
  withRetry
} from '../src/utils/apiGuard.js'

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
}

/* ---------- A. cleanParams：query 里不许出现 undefined ---------- */
console.log('\n===== A. cleanParams（请求侧）=====')
const cleaned = cleanParams({ current: 1, size: 100, keyword: undefined, platform: undefined, genre: null })
ok('A1 undefined / null 被清掉', !('keyword' in cleaned) && !('platform' in cleaned) && !('genre' in cleaned), JSON.stringify(cleaned))
ok('A2 有效参数原样保留', cleaned.current === 1 && cleaned.size === 100)
ok('A3 空串保留（本后端把 `platform=` 视同「不带」）', 'platform' in cleanParams({ platform: '' }))
ok('A4 不改动入参', (() => { const src = { a: undefined, b: 1 }; cleanParams(src); return 'a' in src })())
ok('A5 null / 非对象入参返回空对象', Object.keys(cleanParams(null)).length === 0 && Object.keys(cleanParams('x')).length === 0)
ok('A6 0 / false 这类假值不能被误删', cleanParams({ a: 0, b: false }).a === 0 && cleanParams({ a: 0, b: false }).b === false)

/* ---------- B. isPagedBody：空/异常响应必须被识破 ---------- */
console.log('\n===== B. isPagedBody（响应侧）=====')
ok('B1 正常分页体为真', isPagedBody({ records: [], total: 0, current: 1 }))
ok('B2 data:null（鉴权失败的 Result）为假', !isPagedBody(null))
ok('B3 裸数组为假（回复接口那种形态）', !isPagedBody([1, 2, 3]))
ok('B4 网关兜底页 / 非法 JSON 为假', !isPagedBody('<html>502 Bad Gateway</html>') && !isPagedBody({}))
ok('B5 只有 total 没有 records 为假', !isPagedBody({ total: 80 }))

/* ---------- C. foldGameRecords：计数与映射 ---------- */
console.log('\n===== C. foldGameRecords（游戏元数据折叠）=====')
const GAMES = [
  { id: 16, platform: '多平台', genre: '魂类' },
  { id: 20022, platform: '手机', genre: '射击' },
  { id: 2, platform: '多平台', genre: 'RPG' },
  { id: 5, platform: 'PC', genre: 'RPG' },
  { id: 9, platform: '', genre: '' }, // 脏数据：平台 / 类型都缺
  { id: null, platform: 'PC' } // 脏数据：没有 id
]
const folded = foldGameRecords(GAMES)
ok('C1 gameId → platform 映射正确', folded.map[16] === '多平台' && folded.map[20022] === '手机' && folded.map[5] === 'PC')
ok('C2 「全部」= 实际收到的款数（与 map 同源）', folded.platforms[''] === 5 && Object.keys(folded.map).length === 5, JSON.stringify(folded.platforms))
ok('C3 各平台款数正确', folded.platforms['多平台'] === 2 && folded.platforms['手机'] === 1 && folded.platforms['PC'] === 1)
ok('C4 缺 id 的记录被丢弃，不污染计数', folded.mapped === 5 && !('null' in folded.map))
ok('C5 类型按收录量倒序，空类型不进清单', folded.genres[0].name === 'RPG' && folded.genres[0].count === 2 && folded.genres.length === 3, JSON.stringify(folded.genres))
ok('C6 空数组不炸、返回可用的空结构', (() => { const f = foldGameRecords(null); return f.mapped === 0 && f.platforms[''] === 0 && f.genres.length === 0 })())

/* ---------- D. isUsableMeta / isUsableIndex：坏缓存判废 ---------- */
console.log('\n===== D. 缓存有效性（自愈通道）=====')
const now = Date.now()
ok('D1 正常缓存可用', isUsableMeta({ at: now, map: { 16: '多平台' } }, 86400000))
ok('D2 🚨 空 map 的坏缓存判废（本次事故缓存就是这个形状）', !isUsableMeta({ at: now, map: {}, genres: [], platforms: { '': 0 } }, 86400000))
ok('D3 过期缓存判废', !isUsableMeta({ at: now - 86400001, map: { 16: '多平台' } }, 86400000))
ok('D4 缺 map / 非对象判废', !isUsableMeta({ at: now }, 86400000) && !isUsableMeta(null) && !isUsableMeta('x'))
ok('D5 索引缓存：非空数组才可用', isUsableIndex({ items: [{ id: 1 }] }) && !isUsableIndex({ items: [] }) && !isUsableIndex(null))

/* ---------- E. withRetry：只兜瞬时故障 ---------- */
console.log('\n===== E. withRetry =====')
let calls = 0
const v = await withRetry(async () => { calls += 1; if (calls < 3) throw new Error('瞬时'); return 'ok' }, { times: 3, delay: 1 })
ok('E1 前两次失败、第三次成功', v === 'ok' && calls === 3)
let calls2 = 0
let err = ''
try {
  await withRetry(async () => { calls2 += 1; throw new Error('稳定失败') }, { times: 2, delay: 1 })
} catch (e) { err = e.message }
ok('E2 稳定失败时按次数收手并抛出原错误', err === '稳定失败' && calls2 === 2)

console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
process.exit(fail === 0 ? 0 : 1)
