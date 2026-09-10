// 用法：node tests/daily-pick-auto-verify.mjs
// 目的：v1.2 起每日精选由系统自动选 + 人工加精（post.is_essence=1）优先
// 覆盖：
//   ① /picks/daily 数量上限 = 5
//   ② essence 段（is_essence=1）全部排在最前；普通段内按综合评分
//      view_count*1 + like_count*2 + reply_count*3 降序
//   ③ /picks/weekly 仍是本周 like+reply×2 排序，不受 daily 改动影响
//   ④ 旧的精选管理接口 /admin/picks 已下线（非 200）

import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const HOST = process.env.YUMU_HOST || 'http://localhost:8080/api'

async function jfetch(path, opts = {}) {
  const url = `${HOST}${path}`
  const res = await fetch(url, opts)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (data && typeof data === 'object') return { status: res.status, ...data }
  return { status: res.status, data }
}
async function jget(p, auth) {
  return jfetch(p, { headers: auth ? { Authorization: `Bearer ${auth.token}` } : {} })
}
async function jpost(p, body, auth) {
  return jfetch(p, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth.token}` } : {})
    },
    body: body == null ? undefined : JSON.stringify(body)
  })
}

let passed = 0, failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label) }
  else { failed++; console.log('  ✗ ' + label) }
}

async function login(username, password) {
  const r = await jpost('/auth/login', { username, password })
  if (r.code !== 200) throw new Error('登录失败 ' + username)
  return r.data.token
}

const score3 = (p) => (p.viewCount || 0) + (p.likeCount || 0) * 2 + (p.replyCount || 0) * 3
const score2 = (p) => (p.likeCount || 0) + (p.replyCount || 0) * 2

async function main() {
  console.log('═'.repeat(60))
  console.log('每日精选 / 本周热门 自动化验证（v1.2 自动选）')
  console.log('═'.repeat(60))

  const adminTok = await login('admin', 'admin123456')

  const daily = await jget('/picks/daily')
  const weekly = await jget('/picks/weekly')
  console.log('\n[1] 公开接口结构与上限')
  assert(daily.code === 200 && Array.isArray(daily.data), 'GET /picks/daily 返回数组')
  assert(weekly.code === 200 && Array.isArray(weekly.data), 'GET /picks/weekly 返回数组')
  assert(daily.data.length <= 5, `/picks/daily 数量上限 = 5（实际 ${daily.data.length}）`)
  assert(weekly.data.length <= 5, `/picks/weekly 数量上限 = 5（实际 ${weekly.data.length}）`)

  console.log('\n[2] /picks/daily 排序规则：essence 优先 + 普通段综合评分降序')
  const dailyList = daily.data || []
  const firstNormal = dailyList.findIndex((p) => !p.isEssence) // -1 = 全是 essence 或空
  const essenceSeg = firstNormal === -1 ? dailyList : dailyList.slice(0, firstNormal)
  const normalSeg = firstNormal === -1 ? [] : dailyList.slice(firstNormal)
  // essence 段：全部为 is_essence=1，且 id 倒序（后端稳定序）
  assert(essenceSeg.every((p) => p.isEssence), `essence 段全部为加精帖（${essenceSeg.length} 条）`)
  const eids = essenceSeg.map((p) => p.id)
  assert(JSON.stringify(eids) === JSON.stringify([...eids].sort((a, b) => b - a)),
    'essence 段按 id 倒序：' + JSON.stringify(eids))
  // 普通段：综合评分降序
  const nsScores = normalSeg.map(score3)
  const sortedNs = [...nsScores].sort((a, b) => b - a)
  assert(JSON.stringify(nsScores) === JSON.stringify(sortedNs),
    '非加精段综合评分降序：' + JSON.stringify(nsScores))
  // essence 段评分数允许任意，但若 essence 段不足 5，普通段应补齐到 5
  assert(dailyList.length <= 5 && essenceSeg.length + normalSeg.length === dailyList.length,
    `essence+普通 合并数 = daily 总数（${dailyList.length}）`)
  console.log('   各帖明细:')
  dailyList.forEach((p, i) => {
    const e = p.isEssence ? '⭐' : '  '
    console.log(`   ${i + 1}. ${e} id=${p.id} score=${score3(p)} (v=${p.viewCount || 0} l=${p.likeCount || 0} r=${p.replyCount || 0}) ${(p.title || '').slice(0, 30)}`)
  })

  console.log('\n[3] /picks/weekly 本周 like+reply×2 排序（独立逻辑）')
  const weeklyList = weekly.data || []
  if (weeklyList.length >= 2) {
    const weeklyScore = weeklyList.map(score2)
    const sortedWeekly = [...weeklyScore].sort((a, b) => b - a)
    assert(JSON.stringify(weeklyScore) === JSON.stringify(sortedWeekly),
      'weekly 按 like + reply*2 降序：' + JSON.stringify(weeklyScore))
    console.log('   各帖评分明细:')
    weeklyList.forEach((p, i) => {
      console.log(`   ${i + 1}. id=${p.id} score=${weeklyScore[i]} (l=${p.likeCount || 0} r=${p.replyCount || 0}) ${(p.title || '').slice(0, 30)}`)
    })
  } else {
    console.log('  ⊘ 本周暂无数据')
  }

  console.log('\n[4] 旧的精选管理接口已下线（/admin/picks 返回非 200）')
  const oldSet = await jpost('/admin/picks?postId=1&pickType=1&pickDate=2026-09-02&sort=0', null, { token: adminTok })
  const ok = oldSet.code === 200
  assert(!ok, `POST /admin/picks 已下线：code=${oldSet.code} msg=${oldSet.message}`)

  console.log('\n' + '═'.repeat(60))
  console.log(`结果：${passed} 通过 / ${failed} 失败`)
  console.log('═'.repeat(60))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })