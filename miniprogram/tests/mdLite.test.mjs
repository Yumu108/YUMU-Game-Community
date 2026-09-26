/**
 * 轻量 Markdown 渲染单元测试（`mdLite.js`）。
 *
 * 运行：
 *   cd miniprogram
 *   node --experimental-default-type=module tests/mdLite.test.mjs
 *
 * 🚨 本组最重要的两条是 **A 组转义** 与 **D 组代码块**：
 *   · A：AI 回复是外部内容（大模型输出，可被提示注入）。先转义再拼标签的顺序一旦写反，
 *        模型只要回一句 `<img onerror=...>` 就等于在页面里执行脚本。
 *   · D：代码块必须先抽走再渲染，否则代码里的 `**` `- ` 会被当成 markdown 语法，渲染出来是坏的。
 */
import { mdToHtml, mdToPlain, escapeHtml } from '../src/utils/mdLite.js'

let pass = 0
let fail = 0

function ok(name, cond, extra = '') {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
}

const has = (s, sub) => String(s).indexOf(sub) !== -1

/* ==================== A. 安全：转义 ==================== */
console.log('===== A. 转义（AI 输出当不可信数据）=====')

{
  const h = mdToHtml('<script>alert(1)</script>')
  ok('A1 尖括号被转义成实体', has(h, '&lt;script&gt;') && !has(h, '<script>'), h)
}

{
  const h = mdToHtml('正常文本 <img src=x onerror=alert(1)>')
  ok('A2 注入用的 img 无法成标签', !has(h, '<img') && has(h, '&lt;img'), h)
}

{
  ok('A3 引号被转义（防属性逃逸）', escapeHtml('a"b\'c') === 'a&quot;b&#39;c', escapeHtml('a"b\'c'))
}

{
  const h = mdToHtml('& 和 <b>')
  ok('A4 裸 & 不会二次成实体', has(h, '&amp; 和') && has(h, '&lt;b&gt;'), h)
}

/* ==================== B. 行内语法 ==================== */
console.log('\n===== B. 行内语法 =====')

{
  const h = mdToHtml('这是**加粗**的字')
  ok('B1 **加粗** → <strong>', has(h, '<strong>加粗</strong>'), h)
}

{
  const h = mdToHtml('用 `npm run dev` 启动')
  ok('B2 `行内代码` → 带样式的 span', has(h, 'npm run dev') && has(h, '<span style='), h)
}

{
  const h = mdToHtml('**未闭合的加粗')
  ok('B3 未闭合语法原样保留（不吞内容）', has(h, '未闭合的加粗'), h)
}

/* ==================== C. 块级语法 ==================== */
console.log('\n===== C. 块级语法 =====')

{
  const h = mdToHtml('# 一级\n## 二级\n### 三级')
  // ⚠️ 断言必须检查「文字落在标签内」，不能只查 `<h1` 存在 ——
  //    惰性量词那个 bug 就是这么漏过去的（标签在、内容却在标签外面，旧断言照样绿）。
  ok(
    'C1 标题层级映射正确（且文字在标签内）',
    has(h, '>一级</h1>') && has(h, '>二级</h2>') && has(h, '>三级</h3>'),
    h
  )
}

{
  const h = mdToHtml('> 这是引用')
  ok('C2 引用 → blockquote 样式 div（文字在标签内）', has(h, 'border-left:3px solid') && has(h, '>这是引用</div>'), h)
}

{
  const h = mdToHtml('- 第一项\n- 第二项')
  ok('C3 无序列表逐项渲染（文字在标签内）', has(h, '>• 第一项</div>') && has(h, '>• 第二项</div>'), h)
}

{
  const h = mdToHtml('1. 甲\n2. 乙')
  ok('C4 有序列表保留序号（文字在标签内）', has(h, '>1. 甲</div>') && has(h, '>2. 乙</div>'), h)
}

{
  const h = mdToHtml('* 星号项\n+ 加号项')
  ok('C5 `*` 与 `+` 也认作列表', has(h, '>• 星号项</div>') && has(h, '>• 加号项</div>'), h)
}

/* ==================== D. 代码块 ==================== */
console.log('\n===== D. 代码块（必须先抽走）=====')

{
  const h = mdToHtml('```js\nconst a = 1;\n```')
  ok('D1 围栏代码块渲染成 pre 容器', has(h, 'white-space:pre-wrap') && has(h, 'const a = 1;'), h)
}

{
  const h = mdToHtml('```\n**不该加粗**\n- 不该是列表\n```')
  ok(
    'D2 代码块内的 markdown 不被解析',
    !has(h, '<strong>') && !has(h, '• 不该是列表') && has(h, '**不该加粗**'),
    h
  )
}

{
  const h = mdToHtml('```\n<script>x</script>\n```')
  ok('D3 代码块内容同样被转义', !has(h, '<script>') && has(h, '&lt;script&gt;'), h)
}

{
  const h = mdToHtml('前面\n```py\na = 1\n```\n后面')
  ok('D4 代码块前后的正文都保留', has(h, '前面') && has(h, '后面') && has(h, 'a = 1'), h)
}

/* ==================== E. 换行与结构 ==================== */
console.log('\n===== E. 换行与结构 =====')

{
  const h = mdToHtml('第一行\n第二行')
  ok('E1 单换行 → <br/>', has(h, '第一行<br/>第二行'), h)
}

{
  const h = mdToHtml('## 标题\n正文')
  ok('E2 块级元素后不叠出空 <br/>', !has(h, '</h2><br/>'), h)
}

{
  const h = mdToHtml('段落一\n\n段落二')
  ok('E3 空行分段仍可读', has(h, '段落一') && has(h, '段落二'), h)
}

/* ==================== F. 边界 ==================== */
console.log('\n===== F. 边界与兜底 =====')

{
  ok('F1 null / undefined / 空串 → 空串', mdToHtml(null) === '' && mdToHtml(undefined) === '' && mdToHtml('') === '')
}

{
  const p = mdToPlain('# 标题\n- 项一\n**粗** `码`\n> 引用')
  ok(
    'F2 mdToPlain 去掉标记保留文字',
    has(p, '标题') && has(p, '· 项一') && has(p, '粗') && has(p, '码') && has(p, '引用') && !has(p, '**') && !has(p, '#'),
    JSON.stringify(p)
  )
}

{
  // 真实回答形态：标题 + 列表 + 加粗混排，检查没有任何原始标记残留
  const real = '## 社区板块\n\nYUMU 社区分为：\n- **攻略心得**：干货\n- **资讯速递**：情报\n\n> 提示：先按游戏进专区'
  const h = mdToHtml(real)
  ok(
    'F3 综合样例：标记全部被消费、文字全在',
    !has(h, '**') &&
      !has(h, '##') &&
      has(h, '社区板块') &&
      has(h, '攻略心得') &&
      has(h, '资讯速递') &&
      has(h, '先按游戏进专区'),
    h
  )
}

console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
process.exit(fail === 0 ? 0 : 1)
