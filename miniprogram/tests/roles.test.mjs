/**
 * 角色 / 权限层单元测试 —— `src/utils/roles.js`。
 *
 * 运行：
 *   cd miniprogram
 *   node --experimental-default-type=module tests/roles.test.mjs
 *
 * 为什么能直接 import：`src/utils/roles.js` **零 import**（刻意设计）。
 *   依赖 `api/config.js` 的模块在普通 Node 里跑不了 —— config 用了 uni-app 条件编译
 *   （`// #ifdef H5` / `#ifndef` 两分支会同时生效 ⇒ 重复声明语法错误）。
 *
 * 🚨 本文件里最值钱的是 **F 组**：它把「前端给谁显示哪个管理动作」与
 *    「后端 `AdminController` 上真实的 `@PreAuthorize`」**对起来**。
 *    这类跨端权限漂移极难人工发现 —— 界面上按钮好好地摆着，
 *    点下去才 403，或者更糟：**本该 403 的却成功了**（真实越权）。
 *    同项目 OASys 的 BUG-002「考勤微服务不校验 JWT 就能读他人数据」正是此类。
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ROLE,
  TONE,
  identityOf,
  hasRole,
  canSeeManageEntry,
  shouldShowManageEntry,
  actionsFor,
  permissionSummary,
  badgeMeta
} from '../src/utils/roles.js'

let pass = 0
let fail = 0
let skip = 0

function ok(name, cond, extra = '') {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
}

function skipped(name, why) {
  skip += 1
  console.log(`⏭️ ${name}（跳过：${why}）`)
}

/** 造一个「后端 UserInfoVO 形状」的对象（字段名照抄 AuthServiceImpl#toVO 的填充） */
function vo(over = {}) {
  return {
    id: 20142,
    username: 'yumu_admin',
    nickname: '管理员',
    avatar: '',
    roles: ['USER'],
    badge: null,
    badgeColor: null,
    badgeText: null,
    moderatorBoardIds: [],
    moderatorBoardNames: [],
    ...over
  }
}

/* ==================== A. identityOf：抽取与降级 ==================== */
console.log('===== A. identityOf（后端 VO → 端内存储字段）=====')

{
  const full = vo({
    roles: ['USER', 'MODERATOR'],
    badge: 'MODERATOR',
    badgeColor: 'warning',
    badgeText: '版主',
    moderatorBoardIds: [1, 4],
    moderatorBoardNames: ['原神 攻略区', '崩铁 资讯区']
  })
  const r = identityOf(full)
  ok(
    'A1 完整 VO → 六个身份字段全部保留',
    r.roles.length === 2 &&
      r.badge === 'MODERATOR' &&
      r.badgeColor === 'warning' &&
      r.badgeText === '版主' &&
      r.moderatorBoardIds.length === 2 &&
      r.moderatorBoardNames.length === 2,
    JSON.stringify(r)
  )
}

{
  // 后端 badge* 对普通用户就是 null（BadgeService 明确置 null）⇒ 必须降级成 ''
  const r = identityOf(vo({ roles: ['USER'], badge: null, badgeColor: null, badgeText: null }))
  ok(
    'A2 普通用户 badge 为 null → 降级为空串（不留 null）',
    r.badge === '' && r.badgeColor === '' && r.badgeText === '',
    JSON.stringify({ badge: r.badge, badgeColor: r.badgeColor, badgeText: r.badgeText })
  )
}

{
  const r = identityOf({ id: 1 })
  ok(
    "A3 字段全缺 → 降级为 '' / []，且不含 undefined",
    Array.isArray(r.roles) && r.roles.length === 0 && !JSON.stringify(r).includes('undefined'),
    JSON.stringify(r)
  )
}

{
  // 脏数据：混入 null / 数字 / 空串 / 重复，只留合法去重后的字符串
  const r = identityOf(vo({ roles: ['ADMIN', 'ADMIN', '', null, 7, 'MODERATOR'] }))
  ok('A4 roles 去重 + 剔除非法项', r.roles.join(',') === 'ADMIN,MODERATOR', JSON.stringify(r.roles))
}

{
  const r = identityOf(vo({ moderatorBoardNames: ['原神 攻略区', '', null, 5, '崩铁 资讯区'] }))
  ok(
    'A5 moderatorBoardNames 剔除空值与非字符串',
    r.moderatorBoardNames.join(',') === '原神 攻略区,崩铁 资讯区',
    JSON.stringify(r.moderatorBoardNames)
  )
}

{
  let threw = false
  try {
    identityOf(null)
    identityOf(undefined)
  } catch (e) {
    threw = true
  }
  ok('A6 入参为 null / undefined 不抛异常', !threw)
}

/* ==================== B. 角色判定与「本地闸门」 ==================== */
console.log('===== B. hasRole / canSeeManageEntry =====')

{
  ok('B1 ADMIN 命中', hasRole(['USER', 'ADMIN'], ROLE.ADMIN) === true)
  ok('B2 MODERATOR 命中', hasRole(['MODERATOR'], ROLE.MODERATOR) === true)
  ok('B3 普通用户查 ADMIN 落空', hasRole(['USER'], ROLE.ADMIN) === false)
  ok('B4 空列表 / undefined 不抛且为 false', hasRole([], ROLE.ADMIN) === false && hasRole(undefined, ROLE.ADMIN) === false)
}

{
  // 🚨 这条是「普通用户不该白挨 403」的护栏：本地闸门必须先拦住
  ok('B5 普通用户：看不到管理入口（不发 /admin 请求）', canSeeManageEntry(['USER']) === false)
  ok('B6 未登录：看不到管理入口', canSeeManageEntry([]) === false)
  ok('B7 管理员：可见', canSeeManageEntry(['USER', 'ADMIN']) === true)
  ok('B8 版主：可见（具体能不能管这篇再由 can-review 精确判）', canSeeManageEntry(['MODERATOR']) === true)
}

/* ==================== C. actionsFor：动作清单 ==================== */
console.log('===== C. actionsFor（角色 × 是否公开）=====')

const keys = (roles, nonPublic) => actionsFor(roles, { nonPublic }).map((a) => a.key).join(',')

{
  ok('C1 普通用户 → 无任何管理动作', keys(['USER'], false) === '', `得到「${keys(['USER'], false)}」`)
  ok('C2 未登录 → 无任何管理动作', keys([], false) === '')
  ok('C3 管理员 / 公开帖 → 置顶+加精+隐藏', keys(['ADMIN'], false) === 'pin,essence,hide', keys(['ADMIN'], false))
  ok(
    'C4 版主 / 公开帖 → 加精+隐藏（**不含置顶**，后端置顶仅 ADMIN）',
    keys(['MODERATOR'], false) === 'essence,hide',
    keys(['MODERATOR'], false)
  )
  ok(
    'C5 管理员 / 非公开帖 → 置顶+加精+恢复（**不含隐藏**）',
    keys(['ADMIN'], true) === 'pin,essence,restore',
    keys(['ADMIN'], true)
  )
  ok(
    'C6 版主 / 非公开帖 → 加精+恢复（不含置顶、不含隐藏）',
    keys(['MODERATOR'], true) === 'essence,restore',
    keys(['MODERATOR'], true)
  )
}

{
  // 「隐藏」与「恢复」永远不能同时出现 —— 两个都给只会让人点错
  const combos = [
    [['ADMIN'], false],
    [['ADMIN'], true],
    [['MODERATOR'], false],
    [['MODERATOR'], true]
  ]
  const bad = combos.filter(([r, np]) => {
    const k = actionsFor(r, { nonPublic: np }).map((a) => a.key)
    return k.includes('hide') && k.includes('restore')
  })
  ok('C7 隐藏与恢复互斥（4 种组合都不并存）', bad.length === 0, JSON.stringify(bad))
}

{
  // 「我的权限」卡直接用 short 拼一句话概览，缺字段会在界面上显示 undefined
  const miss = [['ADMIN'], ['MODERATOR']]
    .flatMap((r) => [false, true].flatMap((np) => actionsFor(r, { nonPublic: np })))
    .filter((a) => !a.key || !a.label || !a.short || !a.tip)
  ok('C8 每个动作都带 key/label/short/tip（UI 与弹层都能直接用）', miss.length === 0, JSON.stringify(miss))
}

/* ==================== D. permissionSummary：权限画像 ==================== */
console.log('===== D. permissionSummary（「我的权限」卡片）=====')

{
  const s = permissionSummary(vo({ roles: ['USER', 'ADMIN'] }))
  ok(
    'D1 管理员画像（配色沿用后端 danger 词表）',
    s.label === '管理员' && s.color === TONE.ADMIN && s.scope === '全站范围' && s.can.length >= 3,
    `${s.label} / ${s.color} / ${s.scope}`
  )
}

{
  const s = permissionSummary(vo({ roles: ['MODERATOR'], moderatorBoardNames: ['原神 攻略区'] }))
  ok(
    'D2 版主画像：把负责板块名摊开（这是最直观的「权限范围」证据）',
    s.label === '版主' && s.color === TONE.MODERATOR && s.scope.includes('原神 攻略区'),
    `${s.label} / ${s.scope}`
  )
}

{
  const s = permissionSummary(vo({ roles: ['MODERATOR'], moderatorBoardNames: [] }))
  ok('D3 版主但无板块 → 如实说「暂未分配」，不假装有权限', s.scope === '暂未分配负责板块', s.scope)
}

{
  const s = permissionSummary(vo({ roles: ['USER'] }))
  ok('D4 普通用户画像', s.code === ROLE.USER && s.label === '普通用户' && s.color === TONE.USER, s.label)
}

{
  // 与 BadgeService#compute 同口径：含 ADMIN 时不再按版主展示
  const s = permissionSummary(vo({ roles: ['ADMIN', 'MODERATOR'] }))
  ok('D5 同时有 ADMIN 与 MODERATOR → 取更高的管理员', s.code === ROLE.ADMIN, s.code)
}

/* ==================== E. badgeMeta：徽章 ==================== */
console.log('===== E. badgeMeta =====')

{
  const m = badgeMeta(vo({ roles: ['MODERATOR'], badgeText: '超级版主', badgeColor: 'warning' }))
  ok('E1 后端下发文案优先（后端改文案前端不用动）', m.text === '超级版主', JSON.stringify(m))
}

{
  const m = badgeMeta(vo({ roles: ['ADMIN'], badge: 'ADMIN', badgeColor: null, badgeText: null }))
  ok('E2 字段缺失时按 roles 兜底', m.text === '管理员' && m.color === 'danger', JSON.stringify(m))
}

{
  const m = badgeMeta(vo({ roles: ['USER'] }))
  ok('E3 普通用户无徽章（text 为空 ⇒ 调用方不渲染）', m.text === '' && m.color === '', JSON.stringify(m))
}

/* ==================== F. 跨端一致性：前端动作 vs 后端注解 ====================
 * 本组把「UI 显示什么」与「后端真正允许什么」对上。
 * 一个前端错配的后果不是「不好看」，而是**越权**或**处处 403**，所以值得用测试钉死。
 */
console.log('===== F. 跨端一致性（roles.js ↔ api/admin.js ↔ AdminController.java）=====')

const adminApiPath = fileURLToPath(new URL('../src/api/admin.js', import.meta.url))
const ctrlPath = fileURLToPath(
  new URL('../../backend/src/main/java/com/yumu/community/controller/AdminController.java', import.meta.url)
)

{
  // F1: actionsFor 可能产出的 key 全集，必须与 api/admin.js 的 runManageAction 分发表**完全一致**。
  //     （防的是「UI 冒出个『恢复』按钮，而接口封装里根本没实现」）
  const src = fs.readFileSync(adminApiPath, 'utf8')
  const m = src.match(/const TABLE = \{([\s\S]*?)\}/)
  const declared = m ? [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]).sort() : []

  const union = new Set()
  ;[['USER'], ['MODERATOR'], ['ADMIN'], ['ADMIN', 'MODERATOR'], []].forEach((roles) => {
    ;[false, true].forEach((np) => {
      actionsFor(roles, { nonPublic: np }).forEach((a) => union.add(a.key))
    })
  })
  const produced = [...union].sort()

  ok(
    'F1 动作 key 与 api/admin.js 分发表完全一致（不多不少）',
    declared.length > 0 && produced.join(',') === declared.join(','),
    `UI 产出=[${produced.join(',')}]  接口表=[${declared.join(',')}]`
  )
}

if (!fs.existsSync(ctrlPath)) {
  skipped('F2-F5 后端注解核对', '未找到 backend/ 源码（只解压了小程序）')
} else {
  const ctrl = fs.readFileSync(ctrlPath, 'utf8')

  /**
   * 取某个端点的注解块。
   *
   * 🚨 用「第一个空行」切，**不要**用 `\n    @` 切 —— 后者会在 `@PreAuthorize` 处
   *    就把块截断（它是紧随 `@PostMapping` 的下一行），于是永远找不到注解；
   *    而若改成往后找，又会**吃进下一个方法的 JSDoc 注释** ——
   *    `AdminController` 里恰好有一段注释写着 `之前固定 @PreAuthorize("hasRole('ADMIN')") 把版主挡在外面，是 bug`，
   *    朴素匹配就会把它当成真的注解，判出「置顶仅 ADMIN」的假结论（第一次跑就是这么误报的）。
   */
  function blockOf(path) {
    const marker = `@PostMapping("/posts/{id}/${path}")`
    const i = ctrl.indexOf(marker)
    if (i < 0) return null
    return ctrl.slice(i).split('\n\n')[0]
  }

  {
    const cls = ctrl.includes(`@PreAuthorize("hasAnyRole('ADMIN','MODERATOR')")`)
    ok('F2 类级注解仍是 hasAnyRole(ADMIN,MODERATOR)（普通用户调 /admin 必 403 的前提）', cls)
  }

  {
    const b = blockOf('pin')
    ok(
      'F3 置顶后端**仅 ADMIN** ⇒ 前端也只给 ADMIN 显示',
      !!b && b.includes(`hasRole('ADMIN')`),
      b ? b.replace(/\s+/g, ' ').slice(0, 90) : '未找到 /posts/{id}/pin 端点'
    )
  }

  {
    // 加精 / 隐藏 / 恢复走 assertCanModeratePost（管理员全权 + 版主限负责板块）
    const targets = ['essence', 'hide', 'restore']
    const bad = targets.filter((t) => {
      const b = blockOf(t)
      return !b || b.includes(`hasRole('ADMIN')`) || !b.includes('assertCanModeratePost')
    })
    ok(
      'F4 加精 / 隐藏 / 恢复走 assertCanModeratePost（并非仅 ADMIN）⇒ 前端给版主显示是对的',
      bad.length === 0,
      bad.length ? `不匹配的端点：${bad.join(', ')}` : '三个端点均无方法级 ADMIN 限制'
    )
  }

  {
    // can-review 必须是 GET，且**不带**方法级 @PreAuthorize（版主要能拿到 {canReview:false} 而非 403）
    const i = ctrl.indexOf('@GetMapping("/posts/{id}/can-review")')
    const b = i >= 0 ? ctrl.slice(i).split('\n\n')[0] : null
    ok(
      'F5 can-review 是 GET 且无方法级角色限制（版主据此拿到 false 而非 403）',
      !!b && !b.includes('hasRole('),
      b ? b.replace(/\s+/g, ' ').slice(0, 90) : '未找到 /posts/{id}/can-review 端点'
    )
  }
}

/* ==================== G. 管理入口闸门（本地角色 + 后端探测） ====================
 * 本组钉死一个**语义陷阱**：`can-review` 与 `hide/essence/restore` 用的不是同一个后端判断。
 * 若把两者当成一回事（直接拿 canReview 当唯一闸门），结果就是
 * 「管理员在自己发的帖子（比如官方公告）上反而看不到管理入口」。
 */
console.log('===== G. shouldShowManageEntry（入口闸门）=====')

{
  ok(
    'G1 管理员看**自己的帖子**（can-review=false）→ 仍显示入口',
    shouldShowManageEntry(['USER', 'ADMIN'], false) === true
  )
  ok('G2 管理员 + canReview=true（他人的帖子）→ 显示', shouldShowManageEntry(['ADMIN'], true) === true)
}

{
  ok('G3 版主 + canReview=true（自己负责的板块）→ 显示', shouldShowManageEntry(['MODERATOR'], true) === true)
  ok(
    'G4 版主 + canReview=false（不管这个板块）→ 不显示（避免点了才 403）',
    shouldShowManageEntry(['MODERATOR'], false) === false
  )
}

{
  ok(
    'G5 普通用户即使探测到 true 也不显示（防御性：正常路径根本不会去探测）',
    shouldShowManageEntry(['USER'], true) === false
  )
  ok('G6 未登录 → 不显示', shouldShowManageEntry([], true) === false)
  // 不变量：**显示入口 ⟹ 本地角色闸门必已通过**。
  // 若有人把 shouldShowManageEntry 简化成「只看 canReview」，普通用户就会开始发 can-review
  // 并白挨 403 —— 这条会立刻报警。
  const combos = [['USER'], [], ['ADMIN'], ['MODERATOR'], ['USER', 'ADMIN'], ['USER', 'MODERATOR']]
  const viol = combos.filter((r) =>
    [true, false].some((cr) => shouldShowManageEntry(r, cr) && !canSeeManageEntry(r))
  )
  ok(
    'G7 不变量：显示入口 ⟹ 本地角色闸门已通过（普通用户绝不会走到探测）',
    viol.length === 0,
    viol.length ? `违例：${JSON.stringify(viol)}` : '六种角色组合均满足'
  )
}

/* ==================== 汇总 ==================== */
console.log('')
console.log(`通过 ${pass} / 失败 ${fail}${skip ? ` / 跳过 ${skip}` : ''}`)
if (fail > 0) process.exit(1)
