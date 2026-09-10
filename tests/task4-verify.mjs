// 验证：用户资料/密码接口 + 回关状态同步 + 父板块聚合 + 首页数据
import { execSync } from 'node:child_process'

const BASE = 'http://localhost:8080/api'
let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name) }
}

// 简单请求封装（不依赖 axios，用 node 内置 fetch）
async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, code: data?.code, data: data?.data, raw: data }
}

async function main() {
  console.log('\n== 1. 注册测试用户并登录 ==')
  const u = 'tester_' + Date.now()
  const reg = await req('POST', '/auth/register', { body: { username: u, password: '123456', nickname: u } })
  ok('注册成功', reg.code === 200 && reg.data?.token)
  const token = reg.data.token

  console.log('\n== 2. 修改个人资料（昵称/签名/爱好/常看板块）==')
  const up = await req('PUT', '/users/me/profile', {
    token,
    body: { bio: '我爱玩游戏', hobbies: '原神, 塞尔达, 二次元', favoriteBoardIds: '2,3' }
  })
  ok('资料更新返回 200', up.code === 200)
  const me = await req('GET', '/auth/me', { token })
  ok('me 同步 bio', me.data?.bio === '我爱玩游戏')
  ok('me 同步 hobbies', me.data?.hobbies === '原神, 塞尔达, 二次元')
  ok('me 同步 favoriteBoardIds', me.data?.favoriteBoardIds === '2,3')
  ok('me 同步 nickname', me.data?.nickname === u)

  console.log('\n== 3. 修改密码（原密码正确）==')
  const chg = await req('PUT', '/users/me/password', { token, body: { oldPassword: '123456', newPassword: 'abcdef' } })
  ok('改密成功', chg.code === 200)
  const loginOld = await req('POST', '/auth/login', { body: { username: u, password: '123456' } })
  ok('旧密码失效', loginOld.code === 401 || loginOld.code === 400)
  const loginNew = await req('POST', '/auth/login', { body: { username: u, password: 'abcdef' } })
  ok('新密码可登录', loginNew.code === 200)

  console.log('\n== 4. 改密原密码错误应被拒 ==')
  const chgBad = await req('PUT', '/users/me/password', { token: loginNew.data.token, body: { oldPassword: 'wrong', newPassword: 'zzzzzz' } })
  ok('原密码错误返回 400', chgBad.code === 400)

  console.log('\n== 5. 回关状态同步（粉丝列表 isFollowing 字段）==')
  // 用新密码重新登录 tester，拿到最新 token 与 id（改密后旧 token 可能失效）
  const reLogin = await req('POST', '/auth/login', { body: { username: u, password: 'abcdef' } })
  const token2 = reLogin.data.token
  const myId = reLogin.data.user.id
  // 再注册一个用户 A，让 tester 关注 A，再用 A 的视角看粉丝列表里 tester 应 isFollowing=true
  const ua = 'fa' + (Date.now() % 100000)
  const regA = await req('POST', '/auth/register', { body: { username: ua, password: '123456', nickname: ua } })
  if (!regA.data) {
    console.log('DEBUG regA 异常:', regA.status, regA.code, JSON.stringify(regA.raw))
  }
  const tokenA = regA.data.token
  const idA = regA.data.user.id
  // A 关注 tester 后，tester 出现在 A 的粉丝列表中
  await req('POST', `/follow/${myId}`, { token: tokenA })
  const fans = await req('GET', '/follow/followers', { token: token2 })
  const testerInFans = (fans.data?.records || []).find((x) => x.id === idA)
  ok('粉丝列表包含 A', !!testerInFans)
  // 此时 tester 尚未回关 A -> A（粉丝条目）的 isFollowing 应为 false
  ok('未回关时 A 条目 isFollowing=false', testerInFans?.isFollowing === false)
  // tester 回关 A（即 tester 关注 A）
  await req('POST', `/follow/${idA}`, { token: token2 })
  const fans2 = await req('GET', '/follow/followers', { token: token2 })
  const testerInFans2 = (fans2.data?.records || []).find((x) => x.id === idA)
  ok('回关后 A 条目 isFollowing=true', testerInFans2?.isFollowing === true)
  // tester 再取关 A
  await req('POST', `/follow/${idA}`, { token: token2 })
  const fans3 = await req('GET', '/follow/followers', { token: token2 })
  const testerInFans3 = (fans3.data?.records || []).find((x) => x.id === idA)
  ok('再取关后 A 条目 isFollowing=false', testerInFans3?.isFollowing === false)

  console.log('\n== 6. 父板块聚合子版块帖子 ==')
  const boards = await req('GET', '/boards')
  const parents = boards.data || []
  ok('存在父板块', parents.length > 0)
  if (parents.length) {
    const p = parents[0]
    const boardDetail = await req('GET', `/boards/${p.id}`)
    // 子版块 postCount 之和 <= 父板块
    const kids = (boardDetail.data?.children || [])
    let kidsSum = 0
    for (const k of kids) kidsSum += (k.postCount || 0)
    ok('父板块 postCount >= 子版块之和', (p.postCount || 0) >= kidsSum)
    // 父板块帖子列表应含子版块帖子
    const posts = await req('GET', `/posts?boardId=${p.id}&size=5`)
    ok('父板块可拉到帖子（聚合）', Array.isArray(posts.data?.records))
  }

  console.log('\n== 7. 首页数据可用 ==')
  const hotTags = await req('GET', '/tags/hot?limit=12')
  ok('热门标签可拉取', Array.isArray(hotTags.data))
  const hot = await req('GET', '/posts?sort=hot&size=8')
  ok('热门帖子可拉取', Array.isArray(hot.data?.records))

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常', e); process.exit(2) })
