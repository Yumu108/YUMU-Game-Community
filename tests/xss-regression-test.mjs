// XSS 回归测试：直接 import 前端渲染函数（纯函数，无 DOM 依赖）
// 运行：node tests/xss-regression-test.mjs（位于项目根目录执行）
import { renderRichText } from '../frontend/src/utils/richtext.js'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.error(`  ❌ ${name}`)
  }
}

console.log('\n=== 恶意 payload：必须被中和 ===')

// 1) 属性逃逸：用 &quot; 在属性上下文解码回引号，注入 onerror
const p1 = renderRichText('![x](https://evil.com" onerror="alert(1))')
console.log('   out1:', p1)
check('属性逃逸不产生裸 " 结尾的 onerror (无 ` onerror="`)', !p1.includes(' onerror="'))
check('属性逃逸不产生 `alert(1)"` 裸引号', !p1.includes('alert(1)"'))
check('属性逃逸把引号实体化（含 &quot; 或 &amp;quot;）', p1.includes('&quot;') || p1.includes('&amp;quot;'))
check('属性逃逸整体未生成可执行的 <img onerror>', !/<img[^>]*onerror/i.test(p1))

// 2) javascript: 协议链接
const p2 = renderRichText('[点击](javascript:alert(1))')
console.log('   out2:', p2)
check('javascript: 链接未生成 href', !p2.includes('href='))
check('javascript: 链接整体回退为纯文本', p2.includes('javascript:alert(1)') && !p2.toLowerCase().includes('<a'))

// 3) 裸 <script>
const p3 = renderRichText('你好 <script>alert(1)</script> 世界')
console.log('   out3:', p3)
check('裸 <script> 被转义', !p3.toLowerCase().includes('<script>') && p3.includes('&lt;script&gt;'))

// 4) 事件处理器注入（非图片语法，直接文本）
const p4 = renderRichText('<img src=x onerror=alert(1)>')
console.log('   out4:', p4)
check('直写 <img onerror> 被转义无执行', !/<img[^>]*onerror/i.test(p4) && p4.includes('&lt;img'))

// 5) SVG data URL（img src 不执行脚本，但校验不被当危险协议放行外的破坏）
const p5 = renderRichText('![x](data:image/svg+xml;base64,PHN2Zz4=)')
console.log('   out5:', p5)
check('data:image/svg+xml 仍按图片渲染', p5.includes('<img') && p5.includes('src="data:image/svg+xml'))

// 6) 混合：合法链接 + 恶意图片语法
const p6 = renderRichText('正常 [百度](https://a.com) 和 ![y](https://b.com" onload="x())')
check('混合场景：恶意部分无裸 onload="', !p6.includes(' onload="'))
check('混合场景：合法链接正常渲染', p6.includes('<a href="https://a.com"'))

console.log('\n=== 合法 payload：必须正常渲染 ===')
const ok1 = renderRichText('[链接](https://example.com/path)')
check('合法 https 链接生成 <a href>', ok1.includes('<a href="https://example.com/path"'))
const ok2 = renderRichText('![图](https://example.com/a.png)')
check('合法 https 图片生成 <img src>', ok2.includes('<img src="https://example.com/a.png"'))
const ok3 = renderRichText('![图](data:image/png;base64,iVBORw0KGgo=)')
check('合法 data:image 图片生成 <img src>', ok3.includes('<img src="data:image/png;base64,iVBORw0KGgo="'))
const ok4 = renderRichText('第一行\n第二行')
check('换行转 <br>', ok4.includes('<br>'))

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail === 0 ? 0 : 1)
