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
  SCOPE,
  PLACE,
  PLACE_LABEL,
  identityOf,
  hasRole,
  scopeOf,
  canSeeManageEntry,
  shouldShowManageEntry,
  canManageUsers,
  selfRoleChangeBlocked,
  roleLabel,
  roleTone,
  ASSIGNABLE_ROLES,
  actionsFor,
  permissionSummary,
  badgeMeta,
  CAPABILITIES,
  capabilityMatrix,
  capabilityGroups,
  capabilityGroupStats,
  capabilityStats
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
    moderatorGameIds: [],
    moderatorGameNames: [],
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

{
  /* ---- 审核闭环：待审帖（status=2）才出现的「批准 / 驳回」 ----
   * 🚨 这一组的关键是**批准/驳回必须依赖 canReview**，而加精/隐藏不依赖 —— 因为
   *    后端 `approve`/`reject` 走 `canReviewPost`（多一条「自己不能审自己」），
   *    而 `essence`/`hide` 走 `assertCanModeratePost`（没这条）。
   *    所以同一个帖子上，管理员看自己发的帖：有加精/隐藏、**没有**批准/驳回。
   */
  const pkeys = (roles, over = {}) =>
    actionsFor(roles, { pending: true, ...over }).map((a) => a.key).join(',')

  ok(
    'C9 管理员 / 待审帖（可审）→ 置顶+通过+驳回+加精，且**不给恢复**（与「通过」语义重叠）',
    pkeys(['ADMIN'], { canReview: true }) === 'pin,approve,reject,essence',
    pkeys(['ADMIN'], { canReview: true })
  )
  ok(
    'C10 版主 / 待审帖（可审）→ 通过+驳回+加精（**不含置顶**，审核是版主本职）',
    pkeys(['MODERATOR'], { canReview: true }) === 'approve,reject,essence',
    pkeys(['MODERATOR'], { canReview: true })
  )
  ok(
    'C11 管理员 / 待审帖但 canReview=false（**就是自己发的**）→ 只剩置顶+加精，不给通过/驳回',
    pkeys(['ADMIN'], { canReview: false }) === 'pin,essence',
    pkeys(['ADMIN'], { canReview: false })
  )
  ok(
    'C12 非待审帖绝不出现通过/驳回（pending 未传时）',
    !actionsFor(['ADMIN'], { nonPublic: true }).some((a) => a.key === 'approve' || a.key === 'reject')
  )
  ok(
    'C13 「驳回」标记 needsReason ⇒ 调用方据此弹理由输入框（后端 reason 必填）',
    actionsFor(['ADMIN'], { pending: true, canReview: true }).find((a) => a.key === 'reject')
      ?.needsReason === true
  )
  ok(
    'C14 「置顶」标记 adminOnly ⇒ 矩阵 / 面板可标注「仅管理员」',
    actionsFor(['ADMIN'], {}).find((a) => a.key === 'pin')?.adminOnly === true
  )
  ok(
    'C15 待审帖 + 隐藏/恢复互斥不变量（含 pending 维度也成立）',
    [
      [['ADMIN'], { pending: true, canReview: true }],
      [['MODERATOR'], { pending: true, canReview: true }],
      [['ADMIN'], { pending: false, nonPublic: true }],
      [['MODERATOR'], { nonPublic: false }]
    ].every(([r, ctx]) => {
      const k = actionsFor(r, ctx).map((a) => a.key)
      return !(k.includes('hide') && k.includes('restore'))
    })
  )
}

/* ==================== D. permissionSummary：权限画像 ==================== */
console.log('===== D. permissionSummary（「我的权限」卡片）=====')

{
  const s = permissionSummary(vo({ roles: ['USER', 'ADMIN'] }))
  ok(
    'D1 管理员画像（配色沿用后端 danger 词表；范围是全站所有游戏与板块）',
    s.label === '管理员' &&
      s.color === TONE.ADMIN &&
      s.scope === '全站范围 · 所有游戏与板块' &&
      s.scopeShort === '全站' &&
      s.can.length >= 3,
    `${s.label} / ${s.color} / ${s.scope}`
  )
}

{
  /* 🚨 这一条是 2026-09-26 修正的**真 bug**：
   *    原来用 `moderatorBoardNames` 取范围，但现行授权是**游戏级**
   *    （`setModeratorBoards` 把 `board_id` 统一置 NULL）⇒ `listBoardNamesByUserId`
   *    查出来恒为空 ⇒ 明明是版主却被显示成「暂未分配负责范围」。
   *    正确来源是 `moderatorGameNames`（游戏名）。
   */
  const s = permissionSummary(vo({ roles: ['MODERATOR'], moderatorGameNames: ['原神'] }))
  ok(
    'D2 版主画像：用**负责游戏名**（游戏级授权）而非板块名 —— 修掉「版主显示成暂未分配」的 bug',
    s.label === '版主' && s.color === TONE.MODERATOR && s.scope.includes('原神') && s.scopeShort === '原神',
    `${s.label} / ${s.scope} / short=${s.scopeShort}`
  )
}

{
  // 老数据兼容：只有 boardNames 没有 gameNames 时，仍应展示板块名而不是「未分配」
  const s = permissionSummary(vo({ roles: ['MODERATOR'], moderatorBoardNames: ['攻略区'] }))
  ok('D2b 老数据（只有板块名）仍能展示范围，不误报「未分配」', s.scope.includes('攻略区'), s.scope)
}

{
  const s = permissionSummary(vo({ roles: ['MODERATOR'] }))
  ok('D3 版主但确实无授权 → 如实说「暂未分配」，不假装有权限', s.scope === '暂未分配负责游戏', s.scope)
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
/**
 * 用户 / 角色管理是**另一个** Controller（`AdminUserController`），
 * 类级注解是 `hasRole('ADMIN')`（**不含版主**）—— 与帖子类接口不同。
 * 端内「用户权限管理」页就挂在它下面，所以核对时得单独读这一份。
 */
const userCtrlPath = fileURLToPath(
  new URL('../../backend/src/main/java/com/yumu/community/controller/AdminUserController.java', import.meta.url)
)
/** 端内页面与路由清单 —— J 组用来核对「矩阵说端内已接」是否真的接了 */
const pagesJsonPath = fileURLToPath(new URL('../src/pages.json', import.meta.url))
const adminUsersPagePath = fileURLToPath(new URL('../src/pages/admin/users.vue', import.meta.url))

{
  // F1: actionsFor 可能产出的 key 全集，必须与 api/admin.js 的 runManageAction 分发表**完全一致**。
  //     （防的是「UI 冒出个『恢复』按钮，而接口封装里根本没实现」）
  // 🚨 扫的时候要把 pending / canReview 两个维度也扫上 —— 否则 approve / reject 只在
  //    待审帖出现，用旧的「只扫 nonPublic」写法会漏掉它们，然后这条断言就**空转**了
  //    （两边都是旧集合所以绿，删掉新动作也照样绿）。
  const src = fs.readFileSync(adminApiPath, 'utf8')
  const m = src.match(/const TABLE = \{([\s\S]*?)\}/)
  const declared = m ? [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]).sort() : []

  const union = new Set()
  ;[['USER'], ['MODERATOR'], ['ADMIN'], ['ADMIN', 'MODERATOR'], []].forEach((roles) => {
    ;[false, true].forEach((np) => {
      ;[false, true].forEach((pending) => {
        ;[false, true].forEach((canReview) => {
          actionsFor(roles, { nonPublic: np, pending, canReview }).forEach((a) => union.add(a.key))
        })
      })
    })
  })
  const produced = [...union].sort()

  ok(
    'F1 动作 key 与 api/admin.js 分发表完全一致（不多不少，含 approve/reject）',
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

  {
    /*
     * F6（2026-09-26 第三轮新增）：用户 / 角色管理是**独立的 Controller**，
     * 类级是 `hasRole('ADMIN')`（**不含版主**）。
     *
     * 这条为什么必须有：端内「用户权限管理」入口的判据是
     * `roles.js#canManageUsers`（只认 ADMIN），而不是帖子那边用的
     * `canSeeManageEntry`（hasAnyRole，含版主）。两者一旦被互换，
     * **版主就会看到一个点进去必 403 的入口** —— 而且这种错在界面上一片正常，
     * 只有点下去才暴露。所以这里直接把注解读出来对。
     */
    const okUser = fs.existsSync(userCtrlPath)
    const uctrl = okUser ? fs.readFileSync(userCtrlPath, 'utf8') : ''
    ok(
      'F6 用户/角色管理是类级 hasRole(ADMIN)（**不含版主**）⇒ 端内入口必须只给管理员',
      okUser &&
        /@RequestMapping\("\/admin\/users"\)/.test(uctrl) &&
        /hasRole\(\s*'ADMIN'\s*\)/.test(uctrl) &&
        !/hasAnyRole\([^)]*MODERATOR/.test(uctrl),
      okUser ? 'AdminUserController：类级 hasRole(ADMIN)，无 MODERATOR' : '未找到 AdminUserController.java'
    )
  }

  {
    /*
     * F7：`updateUserRoles` 的后端自保必须还在。
     * 规则是「不能摘掉自己的 ADMIN」—— 这是**不可逆**操作（摘掉后
     * JwtAuthenticationFilter 下一跳就按新角色放行，后台从此没人能进）。
     * 前端 `selfRoleChangeBlocked` 只是体验层的提前提示，真正的边界在这里。
     */
    const implPath = fileURLToPath(
      new URL(
        '../../backend/src/main/java/com/yumu/community/service/impl/AdminUserServiceImpl.java',
        import.meta.url
      )
    )
    const impl = fs.existsSync(implPath) ? fs.readFileSync(implPath, 'utf8') : ''
    ok(
      'F7 updateUserRoles 保留了「不能移除自己的管理员角色」后端自保',
      /不能移除自己的管理员角色/.test(impl) && /operatorId/.test(impl),
      impl ? '已在 AdminUserServiceImpl 中找到该自保' : '未找到 AdminUserServiceImpl.java'
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
  // 🚨 scope 维度必须一起扫：只扫 canReview 的话，「版主跨游戏也被放行」这类回归抓不到。
  const combos = [['USER'], [], ['ADMIN'], ['MODERATOR'], ['USER', 'ADMIN'], ['USER', 'MODERATOR']]
  const scopes = [undefined, SCOPE.ALL, SCOPE.IN, SCOPE.OUT, SCOPE.UNKNOWN, SCOPE.NONE]
  const viol = []
  combos.forEach((r) => {
    scopes.forEach((sc) => {
      ;[true, false].forEach((cr) => {
        if (shouldShowManageEntry(r, cr, sc) && !canSeeManageEntry(r)) viol.push([r, cr, sc])
      })
    })
  })
  ok(
    'G7 不变量：显示入口 ⟹ 本地角色闸门已通过（6 角色 × 6 范围 × 2 探测 = 72 组合）',
    viol.length === 0,
    viol.length ? `违例：${JSON.stringify(viol)}` : '72 种组合全部满足'
  )
}

{
  /* ---- 作用域闸门（2026-09-26 第二轮新增） ----
   * 这一组钉死「管理员 vs 版主」最本质的差异：**管辖范围**。
   */
  ok(
    'G8 版主 + scope=out（非所辖游戏）→ **不显示入口**，哪怕探测说 true 也不显示（拒绝优先）',
    shouldShowManageEntry(['MODERATOR'], true, SCOPE.OUT) === false
  )
  ok(
    'G9 版主 + scope=in（所辖游戏内的**自己的帖子**，canReview=false）→ 仍显示（加精/隐藏仍可做）',
    shouldShowManageEntry(['MODERATOR'], false, SCOPE.IN) === true
  )
  ok(
    'G10 版主 + scope=unknown（老接口没下发 gameIds）→ 回退到后端探测，不误杀',
    shouldShowManageEntry(['MODERATOR'], true, SCOPE.UNKNOWN) === true &&
      shouldShowManageEntry(['MODERATOR'], false, SCOPE.UNKNOWN) === false
  )
  ok('G11 管理员 + scope=out 不可能出现，但即便传入也显示（ADMIN 直通优先）', shouldShowManageEntry(['ADMIN'], false, SCOPE.OUT) === true)
}

/* ==================== H. scopeOf：管辖范围判定 ====================
 * 🚨 本组对应后端 `ModeratorBoardService#covers(userId, gameId, boardId)`。
 *    判定错的方向有两种，**危险程度不同**：
 *      · 把 out 判成 in → 版主看到不该有的入口（点了 403，体验差但安全）；
 *      · 把 in 判成 out  → 版主**丢入口**（看起来像功能坏了，实测时最容易误判成 bug）。
 *    所以 UNKNOWN 必须回退探测，绝不能当成 out。
 */
console.log('===== H. scopeOf（管辖范围：ADMIN 全站 vs 版主单游戏）=====')

{
  ok(
    'H1 管理员 → 全站（处处可管）',
    scopeOf(vo({ roles: ['ADMIN'] }), { gameId: 999 }) === SCOPE.ALL
  )
  ok('H2 普通用户 → none', scopeOf(vo({ roles: ['USER'] }), { gameId: 2 }) === SCOPE.NONE)
  ok('H3 未登录 → none', scopeOf({}, { gameId: 2 }) === SCOPE.NONE)
}

{
  const mod = vo({ roles: ['MODERATOR'], moderatorGameIds: [19], moderatorGameNames: ['三角洲行动'] })
  ok('H4 版主 + 帖子在同游戏 → in', scopeOf(mod, { gameId: 19 }) === SCOPE.IN)
  ok(
    'H5 版主 + 帖子在**别的**游戏 → out（这是「权限作用域」最核心的一条）',
    scopeOf(mod, { gameId: 2 }) === SCOPE.OUT
  )
  ok(
    'H6 gameId 类型归一化：后端给 "19"（字符串）也能命中',
    scopeOf(mod, { gameId: '19' }) === SCOPE.IN
  )
  ok('H7 帖子没带 gameId → unknown（交给后端判，不能当 out）', scopeOf(mod, {}) === SCOPE.UNKNOWN)
}

{
  // 老接口兜底：只有游戏名、没有 gameIds
  const legacy = vo({ roles: ['MODERATOR'], moderatorGameNames: ['三角洲行动'] })
  ok('H8 无 gameIds 时按游戏名兜底匹配', scopeOf(legacy, { gameName: '三角洲行动' }) === SCOPE.IN)
  ok('H9 名字也对不上 → out', scopeOf(legacy, { gameName: '原神' }) === SCOPE.OUT)
  ok(
    'H10 既无 gameIds 也无 gameNames → unknown（宁可回退探测，不可误杀）',
    scopeOf(vo({ roles: ['MODERATOR'] }), { gameId: 2 }) === SCOPE.UNKNOWN
  )
}

{
  // 与后端一致：ADMIN 即使被分配了 moderator_board 也按全站处理（covers 里 ADMIN 直通）
  ok(
    'H11 同时是 ADMIN 与 MODERATOR → 按 ADMIN 全站（与后端 isAdmin 直通一致）',
    scopeOf(vo({ roles: ['ADMIN', 'MODERATOR'], moderatorGameIds: [19] }), { gameId: 2 }) === SCOPE.ALL
  )
}

/* ==================== I. capabilityMatrix：权限矩阵 ====================
 * 「我的权限」卡里那张逐条打勾的表 —— 管理员 11/11、版主 5/11，
 * 这个**数字差**本身就是「两个角色区别很大」的最直接表达。
 */
console.log('===== I. capabilityMatrix（权限矩阵）=====')

const mAdmin = capabilityMatrix(['USER', 'ADMIN'])
const mMod = capabilityMatrix(['MODERATOR'])

{
  ok(
    'I1 管理员 → 全部可用（allowed 全真）',
    mAdmin.length > 0 && mAdmin.every((c) => c.allowed === true),
    `${mAdmin.filter((c) => c.allowed).length}/${mAdmin.length}`
  )
  const st = capabilityStats(['ADMIN'])
  ok('I2 管理员计数 = 全部项数', st.allowed === st.total && st.total === mAdmin.length, JSON.stringify(st))
}

{
  const allowed = mMod.filter((c) => c.allowed).map((c) => c.key).sort()
  const denied = mMod.filter((c) => !c.allowed).map((c) => c.key).sort()
  ok(
    'I3 版主只能做审核 / 加精 / 隐藏 / 回复 / 举报这 5 项',
    allowed.join(',') === 'essence,hide,reply,report,review',
    `allowed=[${allowed.join(',')}]`
  )
  ok(
    'I4 版主做不了置顶 / 转待审 / 游戏库 / 用户角色 / 审计日志 / 公告（6 项仅管理员）',
    denied.join(',') === 'audit,game,notice,pending,pin,user',
    `denied=[${denied.join(',')}]`
  )
  ok(
    'I5 管理员 11 项 vs 版主 5 项 —— 「区别很大」的量化表达',
    mAdmin.length === 11 && allowed.length === 5,
    `管理员 ${mAdmin.length} / 版主 ${allowed.length}`
  )
  ok(
    'I6 版主每一项可用能力都带 scoped=true（版主没有任何「全站生效」的能力）',
    mMod.filter((c) => c.allowed).every((c) => c.scoped === true)
  )
  ok(
    'I7 adminOnly 标记只落在「管理员有、版主没有」的项上',
    mMod.filter((c) => c.adminOnly && c.allowed).length === 0 &&
      mAdmin.filter((c) => c.adminOnly).length === 6
  )
  ok(
    'I8 普通用户 → 全部不可用（调用方据此不渲染整张表）',
    capabilityMatrix(['USER']).every((c) => c.allowed === false)
  )
  ok(
    'I9 每项都带 name/api/note，UI 不会渲染出 undefined',
    mAdmin.every((c) => c.name && c.api && typeof c.note === 'string' && typeof c.mp === 'boolean')
  )
}

if (!fs.existsSync(ctrlPath)) {
  skipped('I10-I11 矩阵 ↔ 后端端点核对', '未找到 backend/ 源码（只解压了小程序）')
} else {
  /**
   * 两个 Controller 的源码。**分开存**而不是拼成一个大字符串：
   * 拼起来会让核对变松（审核端点的路径在用户 Controller 里也能"找到"就通过）。
   * 每条 mp 能力必须指明它归哪个 Controller。
   */
  const SOURCES = {
    admin: fs.readFileSync(ctrlPath, 'utf8'),
    user: fs.existsSync(userCtrlPath) ? fs.readFileSync(userCtrlPath, 'utf8') : ''
  }

  /**
   * 端内**真的接了按钮**的能力 → 后端端点必须存在。
   * 🚨 这张表是「I10 防臆造接口」的对照物：谁把矩阵里标成「端内可操作」却根本没写后端端点，
   *    这条会立刻红。反向也查（表里的 key 若已不在 mp=true 集合里，说明表过期了）。
   */
  const MP_ENDPOINTS = {
    review: { src: 'admin', paths: ['/posts/{id}/approve', '/posts/{id}/reject'] },
    essence: { src: 'admin', paths: ['/posts/{id}/essence'] },
    hide: { src: 'admin', paths: ['/posts/{id}/hide', '/posts/{id}/restore'] },
    pin: { src: 'admin', paths: ['/posts/{id}/pin'] },
    // 2026-09-26 第三轮：端内新增「用户权限管理」页 ⇒ 这一项从主站搬进端内
    user: { src: 'user', paths: ['/admin/users', '/{id}/roles', '/{id}/moderator-boards'] }
  }

  const mpKeys = mAdmin.filter((c) => c.mp).map((c) => c.key).sort()
  const missing = mpKeys.filter((k) => {
    const e = MP_ENDPOINTS[k]
    if (!e) return true
    const src = SOURCES[e.src] || ''
    return e.paths.some((p) => !src.includes(p))
  })
  ok(
    'I10 矩阵里标「端内可操作」的每一项，后端都有真实端点（防臆造接口）',
    missing.length === 0 && mpKeys.join(',') === 'essence,hide,pin,review,user',
    missing.length
      ? `缺端点：${missing.join(',')}`
      : `端内项=[${mpKeys.join(',')}]（共 ${mpKeys.length} 项，其中 ${mpKeys.filter((k) => MP_ENDPOINTS[k] && MP_ENDPOINTS[k].src === 'user').length} 项属用户管理）`
  )

  const stale = Object.keys(MP_ENDPOINTS).filter((k) => !mpKeys.includes(k))
  ok('I11 端点对照表不过期（没有「已从端内下线却还留着的 key」）', stale.length === 0, stale.join(','))

  // 类级注解仍是 ADMIN/MODERATOR 双角色 —— 否则版主整条链路的前提就没了
  ok(
    'I12 类级注解仍是 hasAnyRole(ADMIN,MODERATOR)：版主能进 /admin/**',
    /hasAnyRole\(\s*'ADMIN'\s*,\s*'MODERATOR'\s*\)/.test(SOURCES.admin)
  )
}

/* ==================== J. 能力分组 + 端内入口 + 自我降权拦截（2026-09-26 第三轮） ====================
 * 本组对应三条用户诉求：
 *   ① 权限矩阵要能**点开看全部**，并**分清「端内能点 / 只能去主站」**；
 *   ② 管理员要能**搜索用户并改权限**（端内新增页）；
 *   ③ 顺带把「管理员把自己降级」这个不可逆的坑堵上。
 */

console.log('===== J. capabilityGroups / 端内入口 / selfRoleChangeBlocked =====')

{
  const mAdminJ = capabilityMatrix(['USER', 'ADMIN'])
  const groups = capabilityGroups(['USER', 'ADMIN'])

  // ① 分组不重不漏：并集 == 矩阵全集，交集为空。
  //    🚨 这条防的是「新增能力时忘了分类」—— 只按 mp 过滤的话，
  //       分类条件写错（比如误用 === true 比较字符串）会让某一组静默变空，
  //       界面上看起来只是「少了几个功能」，没有任何报错。
  const flat = groups.flatMap((g) => g.items.map((c) => c.key))
  const allKeys = mAdminJ.map((c) => c.key)
  ok(
    'J1 分组不重不漏：并集 == 矩阵全集，且无重复项',
    flat.slice().sort().join(',') === allKeys.slice().sort().join(',') &&
      new Set(flat).size === flat.length,
    `分组=${flat.length} 项 / 矩阵=${allKeys.length} 项`
  )

  // ② 组顺序固定「端内 → 主站」，且每组都有标题与说明（UI 直接渲染，缺了会出现空标题）
  ok(
    'J2 组顺序为 [小程序内, 主站]，且每组都有 badge/title/hint',
    groups.length === 2 &&
      groups[0].key === 'mp' &&
      groups[1].key === 'site' &&
      groups.every((g) => g.badge && g.title && g.hint && g.items.length > 0),
    groups.map((g) => `${g.badge}(${g.items.length})`).join(' + ')
  )

  // ③ 组内每项的 place/placeLabel 必须与小组身份一致（防「分到主站组却写着小程序内」）
  const badPlace = groups.flatMap((g) =>
    g.items.filter((c) => c.place !== g.key || !c.placeLabel).map((c) => c.key)
  )
  ok('J3 组内每项的 place/placeLabel 与所在组一致', badPlace.length === 0, badPlace.join(','))

  // ④ 管理员视野下两组的项数（这就是折叠摘要那一行「端内 5 / 5 · 主站 6 / 6」的数据源）
  const sAdmin = capabilityGroupStats(['USER', 'ADMIN'])
  ok(
    'J4 管理员：端内 5 项（全可用）+ 主站 6 项（全可用）',
    sAdmin.mp === 5 && sAdmin.allowedMp === 5 && sAdmin.site === 6 && sAdmin.allowedSite === 6,
    `端内 ${sAdmin.allowedMp}/${sAdmin.mp} · 主站 ${sAdmin.allowedSite}/${sAdmin.site}`
  )

  // ⑤ 版主：端内仍是 5 项（**分母不变**），但只有 3 项可用 —— 这组数字就是「区别很大」的量化表达
  const sMod = capabilityGroupStats(['MODERATOR'])
  ok(
    'J5 版主：端内 3/5 可用、主站 2/6 可用（分母与管理员相同，分子差 2）',
    sMod.mp === 5 && sMod.allowedMp === 3 && sMod.site === 6 && sMod.allowedSite === 2,
    `端内 ${sMod.allowedMp}/${sMod.mp} · 主站 ${sMod.allowedSite}/${sMod.site}`
  )

  // ⑥ 用户与角色管理**确实**搬进了端内（这是本轮功能的核心声明）
  const userCap = mAdminJ.find((c) => c.key === 'user')
  ok(
    'J6 「用户与角色管理」已标为端内可操作（mp=true），且归入「小程序内」组',
    !!userCap && userCap.mp === true && userCap.place === 'mp' &&
      groups.find((g) => g.key === 'mp').items.some((c) => c.key === 'user'),
    userCap ? `place=${userCap.place} placeLabel=${userCap.placeLabel}` : '未找到 user 能力'
  )

  // ⑦ `mp=true` 不能只是嘴上说说：页面文件与路由都必须真的存在
  const hasPage = fs.existsSync(adminUsersPagePath)
  const pagesJson = fs.existsSync(pagesJsonPath) ? fs.readFileSync(pagesJsonPath, 'utf8') : ''
  ok(
    'J7 端内页真实存在且已在 pages.json 注册（防「矩阵说端内已接、其实页面没写」）',
    hasPage && pagesJson.includes('"pages/admin/users"'),
    hasPage ? '文件+路由均就位' : `缺文件：${adminUsersPagePath}`
  )
}

{
  // 角色文案 / 配色 / 候选表三者的键必须一致 —— UI 三处都用它们渲染，少一处就会出现空白标签
  const codes = ASSIGNABLE_ROLES.map((r) => r.code)
  ok(
    'J8 ASSIGNABLE_ROLES 覆盖 USER/MODERATOR/ADMIN 且每项都有 label/desc',
    codes.join(',') === 'USER,MODERATOR,ADMIN' &&
      ASSIGNABLE_ROLES.every((r) => r.label && r.desc),
    codes.join(',')
  )
  ok(
    'J9 roleLabel / roleTone 对三种角色都给出非空结果，未知 code 原样返回',
    ROLE.USER === 'USER' &&
      roleLabel('ADMIN') === '管理员' &&
      roleLabel('MODERATOR') === '版主' &&
      roleLabel('USER') === '普通用户' &&
      roleTone('ADMIN') === 'danger' &&
      roleTone('MODERATOR') === 'warning' &&
      roleTone('USER') === 'default' &&
      roleLabel('SUPER') === 'SUPER',
    `${roleLabel('ADMIN')}/${roleLabel('MODERATOR')}/${roleLabel('USER')}`
  )
}

{
  /*
   * 自我降权拦截 —— 与后端 `AdminUserServiceImpl#updateUserRoles` 的自保同一规则。
   * 🚨 边界要卡准：**只拦「摘掉自己的 ADMIN」**。
   *    改别人、或管理员把自己重存一遍 ADMIN，都必须放行 ——
   *    拦多了会让管理员连「保存」都点不动（功能看起来坏了）。
   */
  ok(
    'J10 自我降权被拦：自己 → 普通用户 / 版主',
    selfRoleChangeBlocked(1, 1, ['USER']) === true &&
      selfRoleChangeBlocked(1, 1, ['MODERATOR']) === true
  )
  ok(
    'J11 正常放行：自己重存 ADMIN、改别人、id 缺失',
    selfRoleChangeBlocked(1, 1, ['ADMIN']) === false &&
      selfRoleChangeBlocked(1, 1, ['USER', 'ADMIN']) === false &&
      selfRoleChangeBlocked(1, 2, ['USER']) === false &&
      selfRoleChangeBlocked(null, 1, ['USER']) === false
  )
  ok(
    'J12 id 类型归一化：后端给 "1"（字符串）也要认出是自己',
    selfRoleChangeBlocked('1', 1, ['USER']) === true
  )
}

{
  /*
   * `canManageUsers` 与 `canSeeManageEntry` **必须不同** —— 这是本页最容易埋雷的地方。
   * 用户管理接口是类级 hasRole(ADMIN)（见 F6），帖子管理接口是 hasAnyRole(ADMIN,MODERATOR)。
   * 二者互换 ⇒ 版主看到「用户权限管理」入口、点进去 403。
   */
  ok(
    'J13 canManageUsers 只认 ADMIN（版主 false），与 canSeeManageEntry 口径不同',
    canManageUsers(['ADMIN']) === true &&
      canManageUsers(['USER', 'ADMIN']) === true &&
      canManageUsers(['MODERATOR']) === false &&
      canManageUsers(['USER', 'MODERATOR']) === false &&
      canManageUsers(['USER']) === false &&
      canManageUsers([]) === false &&
      canSeeManageEntry(['MODERATOR']) === true,
    'ADMIN→true / MODERATOR→false（而 canSeeManageEntry(MODERATOR)→true）'
  )
}

/* ==================== 汇总 ==================== */
console.log('')
console.log(`通过 ${pass} / 失败 ${fail}${skip ? ` / 跳过 ${skip}` : ''}`)
if (fail > 0) process.exit(1)
