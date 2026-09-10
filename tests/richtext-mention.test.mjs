// richtext.js @提及/用户链接渲染单元验证（node 直接 import，无 vue 依赖）
//   - mentionMarkdown 生成 [@昵称](/user/123)
//   - renderRichText：用户链接 → <a href="/user/123">@昵称</a>，且不再被 renderMentions 嵌套成 <a>
//   - 纯文本 @昵称（未选中补全）→ 普通符号，不渲染成链接；只有补全插入的 [@昵称](/user/N) 才是可点提及
//   - stripMarkdown 对提及链接正常剥离
//   - decorationHtmlFor 字符数 1:1 对齐（光标位置正确性的关键）
// 运行：cd frontend && node ../tests/richtext-mention.test.mjs   （无后端依赖）
import { mentionMarkdown, renderRichText, stripMarkdown, decorationHtmlFor } from '../frontend/src/utils/richtext.js'

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

// 1) mentionMarkdown
const md = mentionMarkdown('管理员', 102)
check('mentionMarkdown 生成 [@管理员](/user/102)', md === '[@管理员](/user/102)', 'got=' + md)
const md2 = mentionMarkdown('张三丰', 999)
check('mentionMarkdown 支持数字 id', md2 === '[@张三丰](/user/999)', 'got=' + md2)

// 2) renderRichText：用户链接 → 用户主页 <a>，且只包一层
const html1 = renderRichText('你好 ' + md + ' 请看看')
check('渲染后含 <a href="/user/102">', html1.includes('<a href="/user/102"') && html1.includes('>@管理员</a>'), html1)
// 检查没有嵌套 <a>：只出现 1 个 /user/102
const opens = (html1.match(/<a /g) || []).length
check('提及链接只生成一个 <a>（无嵌套）', opens === 1, 'opens=' + opens)
check('渲染后不再有 /search?keyword（未被 renderMentions 二次处理）', !html1.includes('/search?keyword'), html1)

// 3) 纯文本 @昵称（未选中补全）→ 普通符号，不渲染成链接
const html2 = renderRichText('纯文本 @张三 提及')
check('纯文本 @ 不渲染成搜索链接', !html2.includes('/search?keyword'), html2)
check('纯文本 @ 保留原样文本', html2.includes('@张三'), html2)

// 4) 混合：选中补全（markdown）+ 手打 @ 同时存在，各自渲染正确
const html3 = renderRichText('我 @张三 手打，另 ' + md + ' 补全')
check('混合文本：存在 /user/102 链接', html3.includes('/user/102'), html3)
check('混合文本：手打 @ 不是搜索链接', !html3.includes('/search?keyword'), html3)

// 5) XSS 兜底：恶意内容不产生裸 HTML / 无 href 注入
const html4 = renderRichText('[@<script>](javascript:alert(1)) 安全')
check('恶意链接文本被转义', !html4.includes('<script>') && !html4.includes('<img'), html4)
// 纯文本中的 javascript: 只是文本，非 href 属性——无危害
check('不产生 href="javascript:" 外链', !/href="javascript:/i.test(html4), html4)
const html5 = renderRichText('[@x" onmouseover="alert(1)](/user/999)')
// 属性逃逸：引号已被实体化，且文本节点里的 onmouseover 不会执行
check('无裸属性注入（<a 标签里没有 onmouseover）', !/<a [^>]*\sonmouseover=/i.test(html5), html5)
check('引号已被实体化', html5.includes('&quot;'), html5)

// 6) stripMarkdown：提及链接剥离成文本
const stripped = stripMarkdown('看这个 ' + md + ' 的回复')
check('stripMarkdown 剥提及链接', stripped.includes('@管理员') && !stripped.includes('['), 'got=' + stripped)

// 7) 渲染换行保持
const html6 = renderRichText('a\nb')
check('换行渲染 <br>', html6.includes('a<br>b'), html6)

// 8) decorationHtmlFor 字符数 1:1 对齐（光标位置正确性的关键）
//    deco HTML 去掉所有标签后剩下的字符数必须等于 markdown 字符串的字符数
function decoTextCount(html) {
  return html.replace(/<[^>]*>/g, '').length
}
const alignCases = [
  { src: '', desc: '空字符串' },
  { src: '你好世界', desc: '纯文本' },
  { src: md, desc: '[@管理员](/user/102)' },
  { src: '前后 ' + md + ' 中间', desc: '混合用户链接' },
  { src: '@张三 兜底 @李四', desc: '纯文本 @' },
  { src: '![图片](https://x.com/a.png)', desc: '图片' },
  { src: '[百度](https://baidu.com)', desc: '外链' },
  { src: md + '\n' + md, desc: '多行用户链接' },
  { src: 'A' + md + 'B' + md + 'C', desc: '三段拼接' }
]
for (const c of alignCases) {
  const d = decorationHtmlFor(c.src)
  const got = decoTextCount(d)
  check('字符数 1:1 对齐：' + c.desc + ' (' + c.src.length + ')', got === c.src.length,
    'src.len=' + c.src.length + ' deco.len=' + got + ' deco=' + d.slice(0, 80))
}

// 9) decorationHtmlFor 视觉上把 [@昵称](/user/uid) 渲染为蓝色 @昵称
const deco1 = decorationHtmlFor(md)
check('deco 渲染包含 deco-mention 蓝色类', deco1.includes('deco-mention') && deco1.includes('class="deco-link'), deco1)
check('deco 显示文本 = @管理员（用户视觉）', deco1.includes('>@管理员</a>'), deco1)
check('deco 中括号段 visibility:hidden 占位',
  deco1.includes('class="deco-hidden">[</span>') && deco1.includes('](/user/102)</span>'),
  deco1)

// 10) deco 对 XSS 兜底：恶意输入不产生裸 HTML / 危险 href
const deco2 = decorationHtmlFor('[@<script>](javascript:alert(1)) 不安全')
check('恶意链接文本被转义', !deco2.includes('<script>'), deco2)
check('不产生 href="javascript:"', !/href="javascript:/i.test(deco2), deco2)
const deco3 = decorationHtmlFor('[@x" onmouseover="alert(1)](/user/999)')
check('属性逃逸被转义', !/<a [^>]*\sonmouseover=/i.test(deco3), deco3)

console.log(`\n═══ richtext 提及渲染验证：通过 ${pass} / 失败 ${fail} ═══`)
process.exit(fail ? 1 : 0)
