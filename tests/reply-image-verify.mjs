/**
 * P0「回复发图」链路验证脚本（9-10 补验）
 *
 * 前置：后端跑在 8080（java -jar target/yumu-community-1.0.0.jar --server.port=8080）
 * 运行：cd tests && node reply-image-verify.mjs
 *
 * 覆盖：
 *   A. 主楼回帖带图
 *      1) 上传一张 PNG → 拿到 /api/files/xxx.png
 *      2) POST /posts/{id}/replies 内容含 ![图片](url) → 创建成功
 *      3) GET /posts/{id}/replies 能读回该回复且 content 保留图片 markdown
 *      4) renderRichText 渲染出 <img src="url">
 *   B. 楼中楼回帖带图（replyToId）
 *      5) 二级回复带图 → 成功且能读回
 *   C. 安全边界
 *      6) javascript: 伪协议的图片 markdown → 不被渲染成 <img>
 *      7) 纯文本回复（无图）仍正常
 *   D. 收尾：删除测试回复，验证已清理
 */

const BASE = process.env.BASE || 'http://127.0.0.1:8080/api'
const ADMIN = { username: 'admin', password: 'admin123456' }

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ' —— ' + extra : ''}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${extra ? ' —— ' + extra : ''}`)
  }
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function get(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(BASE + path, { headers })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function del(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(BASE + path, { method: 'DELETE', headers })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** 上传图片，返回 { status, url, json } */
async function upload(buffer, filename, type, token) {
  const fd = new FormData()
  fd.append('file', new Blob([buffer], { type }), filename)
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers, body: fd })
  const json = await res.json().catch(() => null)
  return { status: res.status, url: json?.data, json }
}

// 1x1 有效 PNG（含正确 magic bytes，通过 A4 上传校验）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const created = [] // 待清理的回复 id

;(async () => {
  console.log('\n=== P0 回复发图：端到端链路验证 ===\n')

  const { renderRichText } = await import('../frontend/src/utils/richtext.js')

  // ---------- 准备 ----------
  const login = await post('/auth/login', ADMIN)
  const token = login.json?.data?.token
  ok('0) 登录成功', login.json?.code === 200 && !!token)

  // 取一个公开帖（GET /posts 只返回 status=0）
  const list = await get('/posts?page=1&size=20', token)
  const target = list.json?.data?.list?.[0] || list.json?.data?.records?.[0]
  ok('0b) 取到可回复的公开帖', !!target?.id, `postId=${target?.id}`)
  if (!target?.id) throw new Error('没有可用帖子，无法继续')

  const postId = target.id

  // ---------- A. 主楼回帖带图 ----------
  console.log('\nA. 主楼回帖带图')
  const up = await upload(PNG, 'reply-shot.png', 'image/png', token)
  ok('1) 上传图片成功并返回 URL', up.json?.code === 200 && typeof up.url === 'string' && up.url.startsWith('/api/files/'), String(up.url))

  const imgMd = `![图片](${up.url})`
  const c1 = await post(`/posts/${postId}/replies`, { content: imgMd }, token)
  const replyId = c1.json?.data?.id ?? c1.json?.data
  ok('2) 带图回帖创建成功', c1.json?.code === 200, `code=${c1.json?.code} ${c1.json?.message || ''}`)
  if (replyId) created.push(replyId)

  const after = await get(`/posts/${postId}/replies`, token)
  const all = after.json?.data || []
  const mine = all.find((r) => r.id === replyId) || all.find((r) => String(r.content || '').includes(String(up.url)))
  ok('3) 读回该回复', !!mine, mine ? `floor=${mine.floor}` : '未找到')
  ok('4) 回复 content 保留图片 markdown', !!mine && String(mine.content).includes(`![图片](${up.url})`),
    mine ? String(mine.content).slice(0, 60) : '')

  const html = renderRichText(mine?.content || '')
  ok('5) renderRichText 渲染出 <img>', /<img[^>]+src=/.test(html), html.slice(0, 90))
  ok('6) <img> 的 src 指向上传的 URL', html.includes(`src="${up.url}"`))

  // ---------- B. 楼中楼回帖带图 ----------
  console.log('\nB. 楼中楼（replyToId）回帖带图')
  const c2 = await post(`/posts/${postId}/replies`, { content: `楼中楼晒图 ![截图](${up.url})`, replyToId: replyId }, token)
  const subId = c2.json?.data?.id ?? c2.json?.data
  ok('7) 二级回复（带图）创建成功', c2.json?.code === 200, `code=${c2.json?.code} ${c2.json?.message || ''}`)
  if (subId) created.push(subId)

  const after2 = await get(`/posts/${postId}/replies`, token)
  const sub = (after2.json?.data || []).find((r) => r.id === subId)
  ok('8) 二级回复 replyToId 正确落库', !!sub && sub.replyToId === replyId, sub ? `replyToId=${sub.replyToId}` : '未找到')
  ok('9) 二级回复内容保留图片标记', !!sub && String(sub.content).includes(String(up.url)))
  ok('10) 二级回复图片可渲染', /<img[^>]+src=/.test(renderRichText(sub?.content || '')))

  // ---------- C. 安全边界 ----------
  console.log('\nC. 安全边界')
  const evil = renderRichText('![x](javascript:alert(1))')
  ok('11) javascript: 伪协议图片不被渲染成 <img>', !/<img/.test(evil), evil.slice(0, 70))

  const txt = await post(`/posts/${postId}/replies`, { content: '纯文本回帖，无图' }, token)
  const txtId = txt.json?.data?.id ?? txt.json?.data
  ok('12) 纯文本回帖仍正常', txt.json?.code === 200)
  if (txtId) created.push(txtId)

  const back = await get(`/posts/${postId}/replies`, token)
  const txtMine = (back.json?.data || []).find((r) => r.id === txtId)
  ok('13) 纯文本回复内容未被破坏', !!txtMine && String(txtMine.content).includes('纯文本回帖'), txtMine ? String(txtMine.content) : '')

  // ---------- D. 清理 ----------
  console.log('\nD. 清理测试数据')
  let deleted = 0
  for (const id of created) {
    const d = await del(`/posts/replies/${id}`, token)
    if (d.json?.code === 200) deleted++
  }
  ok('14) 测试回复已全部清理', deleted === created.length, `${deleted}/${created.length}`)

  const finalList = await get(`/posts/${postId}/replies`, token)
  const leaked = (finalList.json?.data || []).filter((r) => created.includes(r.id))
  ok('15) 列表中不再出现测试回复', leaked.length === 0, `残留 ${leaked.length} 条`)

  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  if (failures.length) console.log('未通过：\n - ' + failures.join('\n - '))
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
