// 验证：发帖到子版块后，子版块与父板块 postCount 同步 +1
const BASE = 'http://localhost:8080/api'

async function req(method, path, body, token) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(BASE + path, opts)
  const j = await r.json()
  if (j.code !== 200) throw new Error(`${method} ${path} code=${j.code}: ${j.message}`)
  return j.data
}

async function main() {
  const suffix = Date.now().toString(36)
  const username = `sync_${suffix}`
  const password = '12345678'
  const nickname = 'SyncTester'

  console.log(`注册并登录测试账号 ${username}`)
  await req('POST', '/auth/register', { username, password, nickname })
  const loginData = await req('POST', '/auth/login', { username, password })
  const token = loginData.token

  const tree = await req('GET', '/boards')
  const parent = tree[0]
  const child = parent.children[0]
  console.log(`选用父板块「${parent.name}」id=${parent.id}，子版块「${child.name}」id=${child.id}`)

  const beforeParent = await req('GET', `/boards/${parent.id}`)
  const beforeChild = await req('GET', `/boards/${child.id}`)
  console.log(`发帖前：父=${beforeParent.postCount}，子=${beforeChild.postCount}`)

  const post = await req('POST', '/posts', {
    boardId: child.id,
    title: '同步测试帖 ' + suffix,
    content: '<p>用于验证父板块计数同步</p>',
    summary: '同步测试',
    tags: []
  }, token)
  console.log(`发帖成功 id=${post.id}`)

  const afterParent = await req('GET', `/boards/${parent.id}`)
  const afterChild = await req('GET', `/boards/${child.id}`)
  console.log(`发帖后：父=${afterParent.postCount}，子=${afterChild.postCount}`)

  const parentOk = afterParent.postCount === beforeParent.postCount + 1
  const childOk = afterChild.postCount === beforeChild.postCount + 1
  console.log(`父板块 +1: ${parentOk ? '✅' : '❌'}`)
  console.log(`子版块 +1: ${childOk ? '✅' : '❌'}`)

  console.log('\n' + (parentOk && childOk ? '✅ 计数同步通过' : '❌ 计数同步失败'))
  process.exit(parentOk && childOk ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
