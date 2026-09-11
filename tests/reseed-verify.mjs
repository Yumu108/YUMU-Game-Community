// 用法：node tests/reseed-verify.mjs
// 作用：演示数据重整（seed-demo-community.mjs）之后的端到端验收 ——
//       走前端真正使用的那些接口，确认每个页面都能拿到"看起来正常"的数据，
//       并交叉校验计数列与真实行数是否一致（前端首页/板块页/游戏专区都直读计数列）。
import process from 'node:process'

const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'
const PWD_DEMO = process.env.DEMO_PWD || '123456'

let pass = 0, fail = 0
const failures = []
function ok (cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`) }
}
function section (t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`) }

async function api (path, { token, method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { http: res.status, ...(json || {}) }
}
async function login (username, password) {
  const r = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (r.code !== 200) throw new Error(`login ${username} failed: ${r.code} ${r.message}`)
  return r.data.token
}

async function main () {
  console.log('═'.repeat(72))
  console.log(' YUMU 演示数据重整 —— 端到端验收')
  console.log(' 目标：', BASE)
  console.log('═'.repeat(72))

  // ---------------------------------------------------------- 登录
  section('登录 / 身份')
  let playerToken = null
  try {
    playerToken = await login('yumu_10057', PWD_DEMO)
    ok(true, `新玩家账号可登录（yumu_10057 / ${PWD_DEMO}）`)
  } catch (e) { ok(false, '新玩家账号可登录', e.message) }

  const adminToken = await login('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
  ok(!!adminToken, '管理员账号可登录（admin / $TEST_ADMIN_PASSWORD）')

  const me = await api('/auth/me', { token: playerToken })
  ok(me.code === 200 && me.data?.nickname, 'GET /auth/me 返回昵称', `nickname=${me.data?.nickname}`)
  const keptToken = await login('yumu', PWD_DEMO).catch(() => null)
  ok(!!keptToken, '保留账号 yumu 仍可用原口令 123456 登录')

  // ---------------------------------------------------------- 板块
  section('首页 / 板块（读 board.post_count）')
  const boards = await api('/boards')
  const bl = boards.data || []
  ok(boards.code === 200 && bl.length === 6, 'GET /boards 返回 6 个板块', `实际 ${bl.length}`)
  const boardNames = bl.map(b => b.name).join('/')
  ok(boardNames === '攻略心得/游戏吐槽/组队大厅/资讯速递/二次创作/其他', '板块名称与顺序正确', boardNames)
  const boardSum = bl.reduce((s, b) => s + (b.postCount || 0), 0)
  ok(boardSum > 300, '各板块帖数合计 > 300', `合计 ${boardSum}`)
  ok(bl.every(b => (b.postCount || 0) > 0), '每个板块都有帖子（无空板块）')

  const perGame = await api('/boards?gameId=2')
  const pg = perGame.data || []
  const pgSum = pg.reduce((s, b) => s + (b.postCount || 0), 0)
  ok(perGame.code === 200 && pg.length === 6 && pgSum > 0, 'GET /boards?gameId=2 返回按游戏统计的帖数', `原神合计 ${pgSum}`)

  // ---------------------------------------------------------- 游戏库
  section('游戏库 / 游戏专区（读 game.post_count）')
  const games = await api('/games?current=1&size=50')
  const gl = games.data?.records || []
  ok(games.code === 200 && gl.length === 19, 'GET /games 返回 19 款游戏', `实际 ${gl.length}`)
  ok(gl.every(g => (g.postCount || 0) > 0), '每款游戏都有帖子')
  const gameSum = gl.reduce((s, g) => s + (g.postCount || 0), 0)
  ok(gameSum === boardSum, '游戏帖数合计 == 板块帖数合计（两套计数口径自洽）', `${gameSum} vs ${boardSum}`)

  const hot = await api('/games/hot?limit=8')
  ok(hot.code === 200 && (hot.data || []).length === 8, 'GET /games/hot 返回 8 个热门游戏')
  ok((hot.data || []).every(g => (g.postCount || 0) > 0), '热门游戏帖数均 > 0')

  const gd = await api('/games/2')
  ok(gd.code === 200 && gd.data?.name === '原神' && gd.data?.postCount > 0, 'GET /games/2 详情正常', `${gd.data?.name} ${gd.data?.postCount} 帖`)
  const gp = await api('/games/2/posts?current=1&size=10')
  ok(gp.code === 200 && (gp.data?.records || []).length > 0, 'GET /games/2/posts 有帖子', `共 ${gp.data?.total} 篇`)
  const gau = await api('/games/2/active-users?limit=6')
  ok(gau.code === 200 && (gau.data || []).length > 0, 'GET /games/2/active-users 有活跃玩家', `${(gau.data || []).length} 人`)
  const gmod = await api('/games/2/moderators')
  ok(gmod.code === 200 && (gmod.data || []).length > 0, 'GET /games/2/moderators 有版主', `${(gmod.data || []).length} 人`)

  // ---------------------------------------------------------- 帖子列表
  section('帖子列表 / 排序')
  const p1 = await api('/posts?boardId=1&sort=latest&current=1&size=10')
  const rec1 = p1.data?.records || []
  ok(p1.code === 200 && rec1.length === 10, '板块 1 最新帖返回 10 条', `total=${p1.data?.total}`)
  ok(rec1.every(p => p.title && p.authorName && p.boardName), '列表项字段齐全（标题/作者/板块）')
  ok(rec1.every(p => p.avatar || p.authorAvatar !== undefined), '列表项带作者头像字段')
  ok(rec1.every(p => /^\d{4}-\d{2}-\d{2}/.test(String(p.createdAt))), '列表项带合法时间')

  for (const sort of ['hot', 'essence', 'reply', 'favorite']) {
    const r = await api(`/posts?sort=${sort}&current=1&size=5`)
    ok(r.code === 200 && (r.data?.records || []).length > 0, `排序 ${sort} 可用`, `共 ${r.data?.total} 篇`)
  }

  // 分页能翻到后面：证明"数量多"
  const deep = await api('/posts?sort=latest&current=20&size=10')
  ok(deep.code === 200 && (deep.data?.records || []).length > 0, '第 20 页仍有数据（帖子量足够多）', `第20页 ${(deep.data?.records || []).length} 条`)

  const p2 = await api('/posts?gameId=2&sort=latest&current=1&size=10')
  ok(p2.code === 200 && (p2.data?.records || []).length > 0, '按游戏过滤帖子可用', `原神 ${p2.data?.total} 篇`)

  // ---------------------------------------------------------- 帖子详情 / 回帖 / 楼中楼
  section('帖子详情 / 回帖 / 楼中楼')
  const hotList = await api('/posts?sort=reply&current=1&size=1')
  const topPost = (hotList.data?.records || [])[0]
  ok(!!topPost, '找到回复最多的帖子用于详情校验')

  const detail = await api(`/posts/${topPost.id}`)
  ok(detail.code === 200 && detail.data?.id === topPost.id, 'GET /posts/{id} 详情正常')
  const replies = await api(`/posts/${topPost.id}/replies`)
  const rl = replies.data || []
  ok(replies.code === 200 && rl.length > 0, 'GET /posts/{id}/replies 有回复', `${rl.length} 条`)
  ok(rl.length === detail.data?.replyCount, '详情页 replyCount 与实际回复数一致', `${detail.data?.replyCount} vs ${rl.length}`)
  const subs = rl.filter(r => r.replyToId)
  ok(subs.length > 0, '存在楼中楼（replyToId 非空）', `${subs.length} 条子回复`)
  ok(rl.some(r => r.floor === 1), '顶级楼层从 1 开始编号')

  const ptags = await api(`/posts/${topPost.id}`).then(r => ({ code: r.code, data: r.data?.tags }))
  ok(ptags.code === 200 && (ptags.data || []).length > 0, '帖子详情带标签', `${(ptags.data || []).length} 个`)

  // 浏览量应与互动量相关（不该出现"高浏览零互动"）
  const eng = await api('/posts?sort=hot&current=1&size=20')
  const er = eng.data?.records || []
  ok(er.every(p => !(p.viewCount > 1500 && p.replyCount === 0 && p.likeCount === 0)), '不存在"高浏览量 + 零互动"的失真数据')

  // ---------------------------------------------------------- 标签 / 搜索
  section('标签 / 搜索')
  const tags = await api('/tags')
  ok(tags.code === 200 && (tags.data || []).length > 20, 'GET /tags 返回标签', `${(tags.data || []).length} 个`)
  const hotTags = await api('/tags/hot?limit=10')
  ok(hotTags.code === 200 && (hotTags.data || []).length > 0, 'GET /tags/hot 热门标签可用')
  ok((hotTags.data || []).every(t => (t.useCount || 0) > 0), '热门标签使用次数均 > 0')

  const srch = await api('/search?keyword=' + encodeURIComponent('攻略') + '&type=all')
  ok(srch.code === 200, 'GET /search 可用')
  const srchPost = await api('/search?keyword=' + encodeURIComponent('原神') + '&type=post&current=1&size=10')
  ok(srchPost.code === 200 && ((srchPost.data?.records || []).length > 0), '搜索"原神"能命中帖子', `共 ${srchPost.data?.total} 篇`)
  const srchUser = await api('/search?keyword=' + encodeURIComponent('菜') + '&type=user')
  ok(srchUser.code === 200 && (srchUser.data || []).length > 0, '搜索用户可用')

  // ---------------------------------------------------------- 用户主页
  section('用户主页')
  const prof = await api('/users/1001')
  ok(prof.code === 200 && prof.data?.nickname, 'GET /users/1001 资料正常', `${prof.data?.nickname}`)
  ok(prof.data?.postCount > 0, '资料页发帖数 > 0', `${prof.data?.postCount} 帖`)
  ok(!!prof.data?.avatar?.startsWith('/avatars/'), '新玩家头像指向生成的 SVG', `${prof.data?.avatar}`)
  ok((prof.data?.favoriteGames || []).length > 0, '资料页有"常玩游戏"', `${(prof.data?.favoriteGames || []).length} 款`)
  const uposts = await api('/users/1001/posts?current=1&size=10')
  ok(uposts.code === 200 && (uposts.data?.records || []).length > 0, 'GET /users/{id}/posts 有内容', `${uposts.data?.total} 篇`)
  const fcounts = await api('/follow/counts/1001', { token: keptToken })
  ok(fcounts.code === 200, 'GET /follow/counts/{id} 可用（需登录）')

  // ---------------------------------------------------------- 通知 / 公告 / 统计
  section('通知 / 公告 / 统计 / 精选')
  const noti = await api('/notifications', { token: keptToken })
  ok(noti.code === 200 && (noti.data || []).length > 10, 'GET /notifications 有通知', `${(noti.data || []).length} 条`)
  const ntypes = new Set((noti.data || []).map(n => n.type))
  ok(ntypes.size >= 3, '通知类型多样（赞/回复/关注/公告…）', `类型 ${[...ntypes].sort().join(',')}`)
  // 注意：/notifications/unread-count 返回的是 { count: n }，不是裸数字
  const unread = await api('/notifications/unread-count', { token: keptToken })
  ok(unread.code === 200 && (unread.data?.count || 0) > 0, '有未读通知（红点可见）', `未读 ${unread.data?.count}`)

  const ann = await api('/announcements?size=5')
  ok(ann.code === 200 && (ann.data || []).length === 5, 'GET /announcements 有公告', `${(ann.data || []).length} 条`)

  const hp = await api('/stats/hot-posts?limit=8')
  ok(hp.code === 200 && (hp.data || []).length === 8, 'GET /stats/hot-posts 返回 8 条', '')
  ok((hp.data || []).every(p => p.title), '热帖均有标题')
  const au = await api('/stats/active-users?limit=8')
  ok(au.code === 200 && (au.data || []).length === 8, 'GET /stats/active-users 返回 8 人')
  ok((au.data || []).every(u => (u.postCount || 0) > 0), '活跃用户发帖数均 > 0')

  const picks = await api('/picks/daily')
  ok(picks.code === 200, 'GET /picks/daily（每日精选）可用')

  const convs = await api('/messages/conversations', { token: keptToken })
  ok(convs.code === 200, 'GET /messages/conversations 可用')

  // ---------------------------------------------------------- 关注流
  section('关注流 / 后台')
  const feed = await api('/posts/following?sort=latest&current=1&size=10', { token: keptToken })
  ok(feed.code === 200 && (feed.data?.total || 0) > 0, 'GET /posts/following（关注流）有内容（首页「关注」Tab 不空）', `共 ${feed.data?.total} 篇`)
  const fw = await api('/follow/following?current=1&size=20', { token: keptToken })
  ok(fw.code === 200 && (fw.data?.records || []).length >= 5, 'yumu 至少关注 5 人', `${(fw.data?.records || []).length} 人`)

  const ap = await api('/admin/posts?current=1&size=10', { token: adminToken })
  ok(ap.code === 200 && (ap.data?.records || []).length === 10, '后台帖子列表可用（admin）')
  const arep = await api('/admin/reports?current=1&size=10', { token: adminToken })
  ok(arep.code === 200 && (arep.data?.records || []).length > 0, '后台举报队列有数据', `共 ${arep.data?.total} 条`)
  const ausr = await api('/admin/users?current=1&size=10', { token: adminToken })
  ok(ausr.code === 200 && ausr.data?.total === 85, '后台用户列表共 85 人（测试号已清）', `total=${ausr.data?.total}`)
  const audit = await api('/admin/audit-logs?current=1&size=10', { token: adminToken })
  ok(audit.code === 200, '后台审计日志可用（admin）')
  const aann = await api('/admin/announcements?current=1&size=10', { token: adminToken })
  ok(aann.code === 200 && aann.data?.total === 6, '后台公告列表 6 条', `total=${aann.data?.total}`)

  const pend = await api('/admin/posts?status=2&current=1&size=10', { token: adminToken })
  ok(pend.code === 200 && pend.data?.total > 0, '后台有待审核帖（审核功能有数据可演示）', `待审 ${pend.data?.total} 篇`)

  // ---------------------------------------------------------- 结果
  console.log('\n' + '═'.repeat(72))
  console.log(` 通过 ${pass} / 失败 ${fail}`)
  if (failures.length) {
    console.log(' 失败项：')
    failures.forEach(f => console.log('   - ' + f))
  }
  console.log('═'.repeat(72))
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
