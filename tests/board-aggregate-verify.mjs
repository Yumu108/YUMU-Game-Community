// 验证：父板块聚合子版块帖子与帖子数
const BASE = 'http://localhost:8080/api'

async function get(path) {
  const r = await fetch(BASE + path)
  const j = await r.json()
  if (j.code !== 200) throw new Error(`${path} code=${j.code}: ${j.message}`)
  return j.data
}

function sumChildren(parent) {
  if (!parent.children || parent.children.length === 0) return parent.postCount || 0
  return (parent.postCount || 0) + parent.children.reduce((s, c) => s + (c.postCount || 0), 0)
}

function findBoard(tree, id) {
  for (const b of tree) {
    if (b.id === id) return b
    if (b.children) {
      const found = b.children.find(c => c.id === id)
      if (found) return found
    }
  }
  return null
}

async function main() {
  console.log('1) GET /boards 检查父板块 postCount 是否等于子版块之和')
  const tree = await get('/boards')
  let pass = true
  for (const parent of tree) {
    if (!parent.children || parent.children.length === 0) continue
    const expected = parent.children.reduce((s, c) => s + (c.postCount || 0), 0)
    const actual = parent.postCount || 0
    const ok = actual === expected
    console.log(`  ${parent.name}: ${actual} (子版块和=${expected}) ${ok ? '✅' : '❌'}`)
    if (!ok) pass = false
  }

  const parentId = tree[0].id
  const childId = tree[0].children?.[0]?.id
  console.log('\n2) GET /boards/{parentId} 与 /boards/{childId}')
  const parentDetail = await get(`/boards/${parentId}`)
  const childDetail = await get(`/boards/${childId}`)
  console.log(`  父板块 ${parentDetail.name}: ${parentDetail.postCount}`)
  console.log(`  子版块 ${childDetail.name}: ${childDetail.postCount}`)

  console.log('\n3) GET /posts?boardId={parentId} 应包含子版块帖子')
  const parentPosts = await get(`/posts?boardId=${parentId}&size=1`)
  const childPosts = await get(`/posts?boardId=${childId}&size=1`)
  console.log(`  父板块下帖子总数 total=${parentPosts.total}`)
  console.log(`  子版块 下帖子总数 total=${childPosts.total}`)
  const aggregateOk = parentPosts.total >= childPosts.total
  console.log(`  父板块 total >= 子版块 total: ${aggregateOk ? '✅' : '❌'}`)
  if (!aggregateOk) pass = false

  console.log('\n4) 父板块下列出的帖子 boardId 应落在子版块中')
  const parentList = await get(`/posts?boardId=${parentId}&size=200`)
  const childIds = new Set(tree[0].children.map(c => c.id))
  const allInChildren = parentList.records.every(p => childIds.has(p.boardId))
  console.log(`  所有 ${parentList.records.length} 条记录都在子版块: ${allInChildren ? '✅' : '❌'}`)
  if (!allInChildren) pass = false

  console.log('\n' + (pass ? '✅ 全部通过' : '❌ 存在失败项'))
  process.exit(pass ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
