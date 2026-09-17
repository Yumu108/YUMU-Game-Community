/**
 * 分类展示纯逻辑单元测试（26 项）。
 *
 * 运行：
 *   cd miniprogram
 *   node --experimental-default-type=module tests/guideQuery.test.mjs
 *
 * 为什么能直接 import：`src/utils/guideQuery.js` **零 import**（刻意设计）——
 *   它旁边的 `guideIndex.js` 依赖 `api/config.js`，而 config 用了 uni-app 条件编译
 *   （`// #ifdef H5` / `#ifndef` 两个分支在普通 Node 里会同时生效 ⇒ 重复声明语法错误），
 *   所以「依赖 config 的模块」没法在 Node 里跑。纯逻辑摘出来就能测，这也是拆文件的动机。
 *
 * 🚨 这批断言的价值：平台计数与「按钮上显示的数字」是同一份数据算出来的，
 *   一旦有人改了筛选逻辑（比如把「手机」写成「手游」去比对 platform），
 *   这里会直接报红，而不是等到线上按钮数字与列表条数对不上才发现。
 */
import {
  queryIndex,
  countByPlatform,
  indexStats,
  relatedOf,
  hotScore,
  cmpLatest
} from '../src/utils/guideQuery.js'

let pass = 0
let fail = 0

function ok(name, cond, extra = '') {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
}

const ids = (arr) => arr.map((x) => x.id).join(',')

/** 夹具：覆盖 4 个平台 / 2 个板块 / 精华 / 置顶 / 长短正文 */
const ITEMS = [
  { id: 1, title: '艾尔登法环 新手开局指南', summary: '开局职业推荐', gameName: '艾尔登法环', platform: 'PC', boardId: 1, createdAt: '2026-09-01T10:00:00', likeCount: 10, replyCount: 2, viewCount: 100, isEssence: 1, isTop: 0 },
  { id: 2, title: '原神 5.2 版本前瞻', summary: '新角色与地图', gameName: '原神', platform: '多平台', boardId: 4, createdAt: '2026-09-05T10:00:00', likeCount: 5, replyCount: 1, viewCount: 50, isEssence: 0, isTop: 1 },
  { id: 3, title: '崩坏星穹铁道 配队思路', summary: '配队与遗器', gameName: '崩坏：星穹铁道', platform: '手机', boardId: 1, createdAt: '2026-09-03T10:00:00', likeCount: 20, replyCount: 0, viewCount: 200, isEssence: 0, isTop: 0 },
  { id: 4, title: '塞尔达 神庙速查', summary: '神庙位置一览', gameName: '塞尔达传说', platform: '主机', boardId: 1, createdAt: '2026-09-02T10:00:00', likeCount: 1, replyCount: 9, viewCount: 30, isEssence: 0, isTop: 0 },
  { id: 5, title: '艾尔登法环 DLC 难度说明', summary: 'DLC 心得', gameName: '艾尔登法环', platform: 'PC', boardId: 1, createdAt: '2026-09-08T10:00:00', likeCount: 3, replyCount: 1, viewCount: 80, isEssence: 0, isTop: 0 }
]
const SNAPSHOT = JSON.stringify(ITEMS)

/* ---------- A. 平台计数 ---------- */
console.log('===== A. countByPlatform（按钮上的数字来源）=====')
const c = countByPlatform(ITEMS)
ok(
  'A1 各平台计数正确',
  c[''] === 5 && c['PC'] === 2 && c['多平台'] === 1 && c['手机'] === 1 && c['主机'] === 1,
  JSON.stringify(c)
)
ok(
  'A2 四档之和 = 全部（分桶互斥、不重不漏）',
  c['PC'] + c['多平台'] + c['手机'] + c['主机'] === c[''],
  `${c['PC']}+${c['多平台']}+${c['手机']}+${c['主机']} vs ${c['']}`
)
ok('A3 空数组不炸', JSON.stringify(countByPlatform([])) === '{"":0}', JSON.stringify(countByPlatform([])))
ok('A4 非数组入参兜底', countByPlatform(null)[''] === 0)

/* ---------- B. 概览 ---------- */
console.log('\n===== B. indexStats（首页统计条）=====')
const st = indexStats(ITEMS)
ok('B1 总篇数 / 覆盖游戏 / 平台档位', st.total === 5 && st.games === 4 && st.platforms === 4, JSON.stringify(st))
ok('B2 游戏名去重（两款「艾尔登法环」算一款）', st.games === new Set(ITEMS.map((i) => i.gameName)).size)

/* ---------- C. 热门权重 ---------- */
console.log('\n===== C. hotScore（与后端口径一致）=====')
ok('C1 权重 = 浏览 + 点赞×2 + 回复×3', hotScore(ITEMS[0]) === 100 + 20 + 6, `id1=${hotScore(ITEMS[0])}`)
ok('C2 回复权重最高（每条 ×3）', hotScore(ITEMS[3]) === 30 + 2 + 27, `id4=${hotScore(ITEMS[3])}`)
ok('C3 缺字段按 0 处理', hotScore({}) === 0)

/* ---------- D. 筛选 ---------- */
console.log('\n===== D. queryIndex · 平台筛选 =====')
ok('D1 筛「PC」只出 PC 的帖', ids(queryIndex(ITEMS, { platform: 'PC' })) === '5,1', ids(queryIndex(ITEMS, { platform: 'PC' })))
ok('D2 筛「主机」只有 1 篇', ids(queryIndex(ITEMS, { platform: '主机' })) === '4')
ok(
  'D3 筛出的条数 = 按钮上的计数（口径必须同源）',
  queryIndex(ITEMS, { platform: 'PC' }).length === c['PC'] && queryIndex(ITEMS, { platform: '手机' }).length === c['手机'],
  `筛 PC=${queryIndex(ITEMS, { platform: 'PC' }).length} 按钮=${c['PC']}`
)
ok('D4 中文键不匹配英文值（防「手机/手游」写错）', queryIndex(ITEMS, { platform: '手游' }).length === 0, 'value 必须是「手机」——展示名才是「手游」')
ok('D5 空值 = 不过滤', queryIndex(ITEMS, { platform: '' }).length === 5)

console.log('\n===== E. queryIndex · 关键词 =====')
ok('E1 命中游戏名', ids(queryIndex(ITEMS, { keyword: '艾尔登' })) === '5,1')
ok('E2 命中标题', ids(queryIndex(ITEMS, { keyword: '5.2' })) === '2')
ok('E3 命中摘要', ids(queryIndex(ITEMS, { keyword: '遗器' })) === '3')
ok('E4 大小写不敏感', ids(queryIndex(ITEMS, { keyword: 'dlc' })) === '5', 'DLC → dlc')
ok('E5 空关键词不过滤', queryIndex(ITEMS, { keyword: '   ' }).length === 5)

/* ---------- F. 排序 ---------- */
console.log('\n===== F. queryIndex · 排序 =====')
ok('F1 最新：置顶优先，再按时间倒序', ids(queryIndex(ITEMS, { sort: 'latest' })) === '2,5,3,4,1', ids(queryIndex(ITEMS, { sort: 'latest' })))
ok('F2 最热：按权重倒序', ids(queryIndex(ITEMS, { sort: 'hot' })) === '3,1,5,2,4', ids(queryIndex(ITEMS, { sort: 'hot' })))
ok('F3 精华：只剩精华帖', ids(queryIndex(ITEMS, { sort: 'essence' })) === '1', ids(queryIndex(ITEMS, { sort: 'essence' })))
ok('F4 排序 + 平台筛选可叠加', ids(queryIndex(ITEMS, { platform: 'PC', sort: 'latest' })) === '5,1')
ok('F5 不改动入参（纯函数）', JSON.stringify(ITEMS) === SNAPSHOT, '调用三次后原数组顺序必须原样')
ok('F6 空输入不炸', queryIndex(null).length === 0 && queryIndex(undefined, {}).length === 0)
ok('F7 同时间用 id 兜底（保证顺序稳定）', cmpLatest({ id: 9, createdAt: '2026-09-01T10:00:00' }, { id: 8, createdAt: '2026-09-01T10:00:00' }) < 0)

/* ---------- G. 相关推荐 ---------- */
console.log('\n===== G. relatedOf（详情页「相关攻略」）=====')
const rel = relatedOf(ITEMS, ITEMS[0], 4)
ok('G1 同游戏优先（先出 id5，再轮到同板块）', ids(rel) === '5,3,4', ids(rel))
ok('G2 永远排除自己', !rel.some((x) => x.id === 1))
ok('G3 limit 生效', relatedOf(ITEMS, ITEMS[0], 2).length === 2)
ok('G4 同平台兜底：一篇 PC 帖也能找到别的 PC 帖', relatedOf([ITEMS[0], ITEMS[4]], ITEMS[0], 3).some((x) => x.id === 5))
ok('G5 无有效 post 时返回空', relatedOf(ITEMS, null).length === 0 && relatedOf(ITEMS, {}).length === 0)
ok('G6 结果不重复', new Set(rel.map((x) => x.id)).size === rel.length)

console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
process.exit(fail === 0 ? 0 : 1)
