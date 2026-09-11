// 用法：node tests/seed-community-posts.mjs
// 目的：向各游戏板块批量灌入真实风格的帖子，让社区看起来饱满有活力。
// 说明：使用多个"种子用户"账号分散作者，帖子覆盖 6 个板块 + 19 个真实游戏。
//       仅向 deleted=0/status=0 可见逻辑写入（复用已修复的 createPost 计数逻辑）。
//       一次性脚本，重复运行会再次发帖（用户态不可幂等）。
const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'
const ADMIN = { u: 'admin', p: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') }
const SEED_PWD = 'SeedPass123!'

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (data && typeof data === 'object') return { status: res.status, ...data }
  return { status: res.status, data }
}
async function login(u, p) {
  const r = await jfetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
  if (r.code !== 200) throw new Error(`login fail ${u}: ${r.message}`)
  return r.data.token
}
// 先尝试登录，失败则注册（让脚本可重复运行而不报 4xx）
async function ensureUser(username, nickname) {
  try { return await login(username, SEED_PWD) }
  catch { /* 不存在则注册 */ }
  const r = await jfetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: SEED_PWD, nickname })
  })
  if (r.code !== 200) throw new Error(`register fail ${username}: ${r.message}`)
  return login(username, SEED_PWD)
}

// ---- 真实游戏（id 1~19；id=1 是"其他游戏"兜底，不专门灌） ----
const ALL_GAMES = [
  { id: 2, name: '原神' }, { id: 3, name: '王者荣耀' }, { id: 4, name: '和平精英' },
  { id: 5, name: '英雄联盟' }, { id: 6, name: 'CS2' }, { id: 7, name: '永劫无间' },
  { id: 8, name: '蛋仔派对' }, { id: 9, name: '第五人格' }, { id: 10, name: '崩坏：星穹铁道' },
  { id: 11, name: '绝区零' }, { id: 12, name: '明日方舟' }, { id: 13, name: '阴阳师' },
  { id: 14, name: 'DOTA2' }, { id: 15, name: 'APEX英雄' }, { id: 16, name: '艾尔登法环' },
  { id: 17, name: '黑神话：悟空' }, { id: 18, name: '塞尔达传说：王国之泪' }, { id: 19, name: '三角洲行动' }
]
// 可用 GAME_IDS=11,12,13 仅灌指定游戏（避免重复发帖）
const envIds = process.env.GAME_IDS ? process.env.GAME_IDS.split(',').map(Number).filter(Boolean) : null
const GAMES = envIds ? ALL_GAMES.filter(g => envIds.includes(g.id)) : ALL_GAMES

const SEED_USERS = [
  { u: 'seed_tivat', n: '提瓦特老咸鱼' }, { u: 'seed_canyon', n: '峡谷一打九' },
  { u: 'seed_chicken', n: '吃鸡苟分王' }, { u: 'seed_train', n: '星铁列车长' },
  { u: 'seed_doctor', n: '方舟刀客塔' }, { u: 'seed_souls', n: '法环受苦人' },
  { u: 'seed_hyrule', n: '海拉鲁旅人' }, { u: 'seed_delta', n: '三角洲干员' },
  { u: 'seed_apex', n: 'APEX猎杀者' }, { u: 'seed_ink', n: '二次元画手' }
]

// 板块模板：key=boardId，含标题模板、正文碎片、标签池
const BOARDS = {
  3: { // 组队大厅
    tags: ['组队', '开黑', '招募', '萌新', '车队'],
    titles: [
      g => `【${g}开黑】今晚8点缺2个队友，会玩就行，带麦来`,
      g => `${g}萌新找固定队，排位副本都行，在线等挺急的`,
      g => `周末${g}冲分车队，差一个C位，要求稳定不坑`,
      g => `${g}休闲娱乐局，不肝不卷，来几个聊得来的`,
      g => `${g}跨平台组队！手机PC都能打，缺3人`
    ],
    body: g => [
      `最近一直在玩${g}，想找几个稳定能聊得来的队友。`,
      `时间安排比较自由，晚上和周末都能上，主打一个轻松愉快。`,
      `有意向的评论区扣1，或者私信我拉群，一起开黑！`
    ]
  },
  2: { // 游戏吐槽
    tags: ['吐槽', 'bug', '吐槽大会', '策划', '心态'],
    titles: [
      g => `说真的，${g}这波更新我是真没看懂，策划在想啥`,
      g => `${g}里最离谱的bug，我直接笑出声`,
      g => `为什么${g}的匹配机制总让我心态爆炸啊`,
      g => `${g}的氪金点越来越多了，老玩家表示累觉不爱`,
      g => `${g}这操作手感，我练了三天还是一坨`
    ],
    body: g => [
      `玩${g}也有一阵子了，今天必须吐槽一波。`,
      `不是针对游戏本身，主要是有些设定真的反人类，越改越迷。`,
      `懂的都懂，评论区说说你被${g}气到的名场面吧。`
    ]
  },
  4: { // 资讯速递
    tags: ['资讯', '更新', '活动', '赛事', '前瞻'],
    titles: [
      g => `${g}官方前瞻公布，新内容看着真香`,
      g => `速报：${g}开启限时活动，奖励直接拉满`,
      g => `${g}赛事总决赛落幕，这波操作直接封神`,
      g => `${g}版本更新公告：平衡性大改，速看`,
      g => `${g}联动确认！这次的跨界是真没想到`
    ],
    body: g => [
      `刚刷到${g}的官方消息，第一时间来同步给大伙。`,
      `这次的重点改动挺多，建议大家先码住慢慢看。`,
      `详细信息放评论区链接了，有消息我也会持续更新。`
    ]
  },
  6: { // 其他
    tags: ['闲聊', '杂谈', '日常', '入坑'],
    titles: [
      g => `今天突然又对${g}上头了，聊聊我的入坑经历`,
      g => `${g}和隔壁比，你们更肝哪个？来唠唠`,
      g => `深夜杂谈：我的${g}年度名场面`,
      g => `${g}居然出圈了，朋友圈都在刷，离谱`,
      g => `入坑${g}一个月，从萌新到退游边缘的心路历程`
    ],
    body: g => [
      `随便唠两句，玩${g}这段时间感触挺多的。`,
      `谈不上攻略，就是一点个人体验，大家凑合看。`,
      `你们和${g}的故事是什么样的？评论区交个朋友。`
    ]
  },
  1: { // 攻略心得
    tags: ['攻略', '技巧', '入门', '配装', '思路'],
    titles: [
      g => `【${g}】新手必看：从零开始的入门指南`,
      g => `盘点${g}最实用的几个技巧，第3个90%的人不知道`,
      g => `${g}高难挑战通关思路详解（附配装）`,
      g => `${g}资源规划避坑指南，别再浪费体力了`,
      g => `${g}版本强势玩法推荐，照着抄就完事`
    ],
    body: g => [
      `整理了一份${g}的实战心得，亲测有效，适合刚入坑或卡关的朋友。`,
      `核心思路是先理解机制再谈操作，别一上来就硬刚。`,
      `有不同打法的欢迎补充，一起把帖子养肥。`
    ]
  },
  5: { // 二次创作
    tags: ['同人', '绘画', '剪辑', 'cos', '表情包'],
    titles: [
      g => `肝了张${g}同人图，第一次画求轻喷`,
      g => `剪了个${g}高燃混剪，BGM一上头就燃了`,
      g => `${g}角色cos完成，妆造花了3小时`,
      g => `用${g}梗做了个表情包，笑不活了`,
      g => `${g}同人短篇，写到凌晨三点停不下来`
    ],
    body: g => [
      `最近沉迷${g}的二创，这次试着整了点活。`,
      `过程比想象中费劲，但成品出来还是挺有成就感的。`,
      `求轻喷也求三连，喜欢的话我后面继续更。`
    ]
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

let ok = 0, fail = 0
async function postOne(token, boardId, game) {
  const b = BOARDS[boardId]
  const title = pick(b.titles)(game.name)
  const content = [title, '', ...b.body(game.name)].join('\n')
  const tags = shuffle([...b.tags]).slice(0, 2)
  const r = await jfetch('/posts', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ boardId, gameId: game.id, title, content, tags })
  })
  if (r.code === 200 && r.data && r.data.id) { ok++; return true }
  fail++; console.log(`  ✗ [b${boardId}/${game.name}] ${r.message || JSON.stringify(r.data)}`)
  return false
}

async function main() {
  console.log('═'.repeat(64))
  console.log('社区帖子批量灌入（种子用户 + 全板块 + 全真实游戏）')
  console.log('═'.repeat(64))

  // 准备种子用户 token
  const tokens = []
  for (const su of SEED_USERS) {
    try { tokens.push({ n: su.n, t: await ensureUser(su.u, su.n) }) }
    catch (e) { console.log('  ! 用户准备失败:', e.message) }
  }
  console.log(`种子用户就绪：${tokens.length} 个`)

  let idx = 0
  for (const game of GAMES) {
    // 稀疏板块必发：组队大厅(3)/游戏吐槽(2)/资讯速递(4)/其他(6)
    const boards = [3, 2, 4, 6]
    // 攻略(1)与二次创作(5)按概率补充，丰富 攻略心得 之外的板块
    if (Math.random() < 0.65) boards.push(1)
    if (Math.random() < 0.65) boards.push(5)
    shuffle(boards)
    for (const bid of boards) {
      const author = tokens[idx % tokens.length]
      idx++
      await postOne(author.t, bid, game)
      await new Promise(r => setTimeout(r, 60)) // 轻量限速，避免冲刷
    }
  }
  console.log('─'.repeat(64))
  console.log(`完成：成功 ${ok} 篇，失败 ${fail} 篇`)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
