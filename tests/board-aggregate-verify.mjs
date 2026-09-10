/**
 * 板块契约验证（9-05「取消板块细分」后的现行契约）
 *
 * 📌 历史：本脚本原用于验证「父板块聚合子版块帖数与帖子」的**树形板块**结构。
 *    9-05 改版后板块收敛为**固定六个平铺分类**（无父子层级，children 恒为 null），
 *    旧断言（tree[0].children[0] 等）已无对应实现，会直接 TypeError。
 *    此处改写为对现行契约的守护，避免留下一个必然报错的僵尸脚本。
 *
 * 🎯 断言：
 *   1. GET /boards 恰好 6 个固定分类，且 children 均为空
 *   2. 每个板块的 postCount 与公开列表 total 一致（口径见 deploy/tools/reconcile-counts.sql）
 *   3. GET /boards/{id} 与列表中的数据一致
 *   4. GET /posts?boardId=X 返回的帖 boardId 全为 X（不再向上聚合）
 */
const BASE = 'http://localhost:8080/api'

async function get(path) {
  const r = await fetch(BASE + path)
  const j = await r.json()
  if (j.code !== 200) throw new Error(`${path} code=${j.code}: ${j.message}`)
  return j.data
}

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.log(`  ❌ ${msg}`) }
}

async function main() {
  console.log('[1] 板块列表：固定六个平铺分类，无父子层级')
  const boards = await get('/boards')
  assert(Array.isArray(boards) && boards.length === 6, `GET /boards 返回 6 个分类（实际 ${boards?.length}）`)
  const expected = ['攻略心得', '游戏吐槽', '组队大厅', '资讯速递', '二次创作', '其他']
  assert(expected.every((n) => boards.some((b) => b.name === n)), `六个固定分类齐全：${expected.join(' / ')}`)
  const anyChildren = boards.some((b) => Array.isArray(b.children) && b.children.length > 0)
  assert(!anyChildren, '没有任何板块带子板块（9-05 起取消板块细分）')

  console.log('\n[2] postCount 与公开列表 total 一致')
  for (const b of boards) {
    const list = await get(`/posts?boardId=${b.id}&size=1`)
    const ok = (b.postCount || 0) === (list.total || 0)
    assert(ok, `板块「${b.name}」postCount=${b.postCount} vs 列表 total=${list.total}`)
  }

  console.log('\n[3] GET /boards/{id} 与列表数据一致')
  for (const b of boards) {
    const detail = await get(`/boards/${b.id}`)
    assert(detail.id === b.id && detail.name === b.name && (detail.postCount || 0) === (b.postCount || 0),
      `板块详情 #${b.id}「${detail.name}」postCount=${detail.postCount} 与列表一致`)
  }

  console.log('\n[4] /posts?boardId=X 只返回该板块（不再向上聚合）')
  const target = boards[0]
  const page = await get(`/posts?boardId=${target.id}&size=200`)
  const all = (page.records || []).every((p) => p.boardId === target.id)
  assert(all, `/posts?boardId=${target.id} 返回的 ${(page.records || []).length} 条帖 boardId 全为 ${target.id}`)

  console.log(`\n═══ 板块契约验证：通过 ${passed} / 失败 ${failed} ═══`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
