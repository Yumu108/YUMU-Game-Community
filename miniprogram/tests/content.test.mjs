/**
 * 正文解析单元测试 —— 重点验证**正文配图不会被丢掉**（10 项）。
 *
 * 运行：
 *   cd miniprogram
 *   node --experimental-default-type=module tests/content.test.mjs
 *
 * 背景：详情页原来是 `stripHtml()` 一把梭转纯文本，`<img>` 被当普通标签删掉，
 *   于是「设计文档里写了支持图片浏览，实际正文里的图一张都看不到」。
 *   现在改成 `contentBlocks()` 出「有序区块」，图片按原位保留。
 *
 * ⚠️ 只能 import `src/utils/content.js`：它**不依赖 config.js**。
 *   config.js 里是 uni-app 的条件编译（`// #ifdef H5` 之类），在纯 Node 下
 *   两个分支会同时生效、`export const` 重复声明直接抛错 —— 所以别把测试写成
 *   间接依赖 config 的模块（如 format.js）。
 */
import { contentBlocks, stripHtml, toParagraphs, summaryOf } from '../src/utils/content.js'

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? '\n     ' + detail : ''}`)
}

console.log('===== A. contentBlocks：图片保留在原位 =====')

const mixed = '<p>先看这张伤害表。</p><img src="/api/files/seed_post_1.jpg" /><p>再照这个顺序打。</p>'
{
  const b = contentBlocks(mixed)
  ok(
    'A1 图文混排 → 3 个区块且顺序正确',
    b.length === 3 && b[0].type === 'text' && b[1].type === 'image' && b[2].type === 'text',
    JSON.stringify(b.map((x) => x.type))
  )
  ok('A2 图片 src 原样取出', b[1] && b[1].src === '/api/files/seed_post_1.jpg', b[1] && b[1].src)
  ok('A3 图片前后的文字都没丢', b[0].text.includes('伤害表') && b[2].text.includes('顺序打'))
}

{
  const b = contentBlocks('<img src="/a.jpg">')
  ok('A4 只有图片时输出 1 个 image 区块', b.length === 1 && b[0].type === 'image')
}

{
  const b = contentBlocks('<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg">')
  ok('A5 连续图片全部保留', b.filter((x) => x.type === 'image').length === 3)
}

{
  // 带其他属性的 img（真实富文本编辑器会带 class/style/alt）
  const b = contentBlocks('<img class="x" alt="封面" data-id="9" src="/d.jpg" style="width:100%">')
  ok('A6 src 不在首位也能取到', b.length === 1 && b[0].src === '/d.jpg', JSON.stringify(b))
}

{
  const b = contentBlocks("<p>图：</p><img src='/quote.jpg'>")
  ok('A7 单引号 src 也能取到', b.some((x) => x.type === 'image' && x.src === '/quote.jpg'))
}

{
  const b = contentBlocks('<p>没有图</p><p>只有文字</p>')
  ok('A8 纯文本 → 全是 text 区块', b.every((x) => x.type === 'text') && b.length === 2)
}

{
  const b = contentBlocks('<img src=""><p>空 src 的图应被忽略</p>')
  ok('A9 空 src 的 img 被忽略（不留空白图块）', b.filter((x) => x.type === 'image').length === 0)
}

console.log('\n===== B. 幂等 / 边界（带 g 的正则最容易踩的坑） =====')

{
  // 🚨 IMG 正则带 `g`，如果跨调用复用同一实例，第二次会因为 lastIndex 不为 0 而漏匹配
  const src = '<img src="/x.jpg"><img src="/y.jpg">'
  const first = contentBlocks(src).filter((x) => x.type === 'image').length
  const second = contentBlocks(src).filter((x) => x.type === 'image').length
  const third = contentBlocks(src).filter((x) => x.type === 'image').length
  ok('B1 重复调用结果一致（无 lastIndex 残留）', first === 2 && second === 2 && third === 2, `${first}/${second}/${third}`)
}

{
  ok('B2 空值安全', contentBlocks(null).length === 0 && contentBlocks('').length === 0 && contentBlocks(undefined).length === 0)
}

console.log('\n===== C. 原有纯文本能力不能被改坏 =====')

{
  ok('C1 stripHtml 仍然剥掉 img 标签', !stripHtml('<p>a</p><img src="/a.jpg"><p>b</p>').includes('img'))
  ok('C2 toParagraphs 仍按空行分段', toParagraphs('甲\n\n乙\n\n丙').length === 3)
  ok('C3 summaryOf 优先用后端 summary', summaryOf({ summary: 'S', content: 'C' }) === 'S')
  ok('C4 summaryOf 超长截断带省略号', summaryOf({ content: 'x'.repeat(100) }, 10).length === 11)
}

console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
process.exit(fail === 0 ? 0 : 1)
