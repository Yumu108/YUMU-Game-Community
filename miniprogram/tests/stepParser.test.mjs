/**
 * 阅读拆解器单元测试（20 项）。
 *
 * 运行：
 *   cd miniprogram
 *   node --experimental-default-type=module tests/stepParser.test.mjs
 *
 * ⚠️ 为什么要 `--experimental-default-type=module`：
 *   `src/utils/*.js` 是 ESM 源码，但 package.json 没有 `"type": "module"`
 *   （uni-app CLI 工程惯例，加了会影响构建）。Node 默认按 CJS 解析 `.js`，
 *   该开关让 Node 把 `.js` 也当 ESM，从而能**直接 import 被测源码**，无需拷贝副本。
 *   因此源码里的相对导入必须带扩展名（`./content.js`），ESM 不做扩展名补全。
 */
import { parseReading } from '../src/utils/stepParser.js'

let pass = 0
let fail = 0

/**
 * @param {string} name
 * @param {string} input
 * @param {{kind:string, titles:string[]}|null} expect
 */
function check(name, input, expect) {
  const r = parseReading(input)
  let ok
  let detail
  if (expect === null) {
    ok = r === null
    detail = ok ? 'null（退化普通正文）' : `期望 null，实得 ${JSON.stringify(r)}`
  } else {
    ok =
      !!r &&
      r.kind === expect.kind &&
      r.items.length === expect.titles.length &&
      r.items.every((s, i) => s.title === expect.titles[i])
    detail = ok
      ? `${r.kind} / ${r.items.length} 张: ${r.items.map((s) => s.title).join(' | ')}`
      : `期望 ${expect.kind}${JSON.stringify(expect.titles)}，实得 ${JSON.stringify(
          r && { kind: r.kind, titles: r.items.map((s) => s.title) }
        )}`
  }
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✅' : '❌'} ${name}\n     ${detail}`)
}

console.log('===== A. 显式序号 → kind=step =====')
check('A1 「第一步/第二步」', '第一步 先攒够原石\n第二步 抽到保底再停\n第三步 打材料本', {
  kind: 'step',
  titles: ['先攒够原石', '抽到保底再停', '打材料本']
})
check('A2 「1. 2. 3.」', '1. 打开设置\n2. 调整画质\n3. 重启游戏', {
  kind: 'step',
  titles: ['打开设置', '调整画质', '重启游戏']
})
check('A3 「1、2、」顿号', '1、找齐三件套\n2、升级到+5\n3、去深渊试伤害', {
  kind: 'step',
  titles: ['找齐三件套', '升级到+5', '去深渊试伤害']
})
check('A4「（1）（2）」全角括号', '（1）选角色\n（2）配圣遗物\n（3）练手法', {
  kind: 'step',
  titles: ['选角色', '配圣遗物', '练手法']
})
check('A5「①②③」圆圈数字', '①开门贴墙走\n②听到脚步就蹲\n③从右侧绕后', {
  kind: 'step',
  titles: ['开门贴墙走', '听到脚步就蹲', '从右侧绕后']
})
check('A6「Step 1」英文', 'Step 1 清小怪\nStep 2 打断读条\nStep 3 集火 BOSS', {
  kind: 'step',
  titles: ['清小怪', '打断读条', '集火 BOSS']
})

console.log('\n===== B. 小标题 → kind=step =====')
check('B1「【】」', '【准备阶段】先看阵容\n【开荒阶段】保留大招\n【收尾阶段】别贪伤害', {
  kind: 'step',
  titles: ['准备阶段', '开荒阶段', '收尾阶段']
})
check('B2「## 」markdown', '## 一阶段说明\n先把小怪清干净\n## 二阶段说明\n注意 boss 横扫', {
  kind: 'step',
  titles: ['一阶段说明', '二阶段说明']
})

console.log('\n===== C. 多段兜底 → kind=step =====')
check(
  'C1 无标记 4 段',
  '先看阵容。建议带双奶提高容错。\n注意 boss 横扫。横扫有明显抬手动作。\n第二阶段会召唤小怪。优先击杀小怪。\n最后收尾。注意别贪伤害。',
  { kind: 'step', titles: ['先看阵容', '注意 boss 横扫', '第二阶段会召唤小怪', '最后收尾'] }
)

console.log('\n===== D. 单段散文 → kind=point（针对线上真实内容）=====')
check(
  'D1 线上 #3005 真实正文',
  '这版本打野前期一定要帮抢中轴，红开反蓝基本是标配。中期带线别单带太深，看小地图随时回防。逆风别硬打团，偷龙换资源才是翻盘',
  {
    kind: 'point',
    titles: [
      '这版本打野前期一定要帮抢中轴，红开反蓝基本是标配',
      '中期带线别单带太深，看小地图随时回防',
      '逆风别硬打团，偷龙换资源才是翻盘'
    ]
  }
)
check('D2 带冒号的句子提为标题', '前期思路：红开反蓝是标配。中期思路：带线别太深。后期思路：别硬打团多偷龙。', {
  kind: 'point',
  titles: ['前期思路', '中期思路', '后期思路']
})
check(
  'D3 三句短句（短句直接当标题）',
  '急停要跟准星回中一起松。架枪别死架，听脚步微调身位。这几条练明白，天梯上分很快。',
  {
    kind: 'point',
    titles: ['急停要跟准星回中一起松', '架枪别死架，听脚步微调身位', '这几条练明白，天梯上分很快']
  }
)

console.log('\n===== E. 退化（必须 null，不报错/不空屏）=====')
check('E1 单段短文本', '这把武器很强，值得抽。', null)
check('E2 空字符串', '', null)
check('E3 null', null, null)
check('E4 两段各一句（句子不足 3）', '第一段内容在这里。\n第二段内容在这里。', null)
check('E5 只有两句', '先看阵容再决定。注意 boss 的横扫动作。', null)

console.log('\n===== F. HTML 正文 =====')
check('F1 HTML <p> 序号', '<p>1. 打开设置</p><p>2. 调整画质</p><p>3. 重启游戏</p>', {
  kind: 'step',
  titles: ['打开设置', '调整画质', '重启游戏']
})
check('F2 HTML 含 script 注入', '<p>1. 正常步骤</p><script>alert(1)</script><p>2. 另一步骤</p>', {
  kind: 'step',
  titles: ['正常步骤', '另一步骤']
})
check('F3 HTML 单段多句 → point', '<p>前期要多刷野。中期别单带太深。后期别硬打团。</p>', {
  kind: 'point',
  titles: ['前期要多刷野', '中期别单带太深', '后期别硬打团']
})

/**
 * 结构性断言 —— 验 `intro` / `section` / `truncated` 这些**不是标题数组**的字段。
 * 单靠上面那种「比标题数组」的方式抓不到「内容被悄悄切掉」。
 */
function checkShape(name, input, verify) {
  let ok = false
  let detail = ''
  try {
    const r = parseReading(input)
    const res = verify(r)
    if (res === true) {
      ok = true
      detail = 'ok'
    } else {
      ok = !!(res && res.ok)
      detail = (res && res.detail) || JSON.stringify(r && { kind: r.kind })
    }
  } catch (e) {
    detail = '断言异常：' + e.message
  }
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✅' : '❌'} ${name}\n     ${detail}`)
}

console.log('\n===== G. 内容保全（导语 / 分组 / 不截断）=====')
/**
 * 🚨 这一组针对 2026-09-17 内容富化后暴露的三处**静默丢内容** ——
 *   导语被丢、分组标题被丢、条目超过 12 条被硬截断。
 *   它们都不报错、不空屏，只是让用户看到一篇「看起来完整、其实少了内容」的文章，
 *   比报错危险得多。所以必须有**直接**断言，而不是只数卡片张数。
 */
checkShape('G1 首个条目之前的内容保留为 intro（原来丢弃）', 'DLC 的难度是按你打完本体的后期强度设计的。\n1. 把等级推到 130 以上\n2. 圣杯瓶强化到 +8', (r) =>
  r && r.kind === 'step' && r.intro.includes('DLC 的难度') && r.items.length === 2
    ? true
    : { ok: false, detail: `intro=「${r && r.intro}」 items=${r && r.items.length}` }
)

checkShape('G2 「【分组】」识别为 section，不占序号也不丢', '【第一梯队：不做会直接卡关】\n1. 把等级推到 130 以上\n2. 圣杯瓶强化到 +8\n【第二梯队：显著降低难度】\n3. 拿到减伤护符\n4. 备一套抗性护甲', (r) =>
  r &&
  r.items.length === 4 &&
  r.items[0].section === '第一梯队：不做会直接卡关' &&
  r.items[2].section === '第二梯队：显著降低难度'
    ? true
    : {
        ok: false,
        detail: `items=${r && r.items.length} sections=${JSON.stringify(r && r.items.map((x) => x.section))}`
      }
)

checkShape(
  'G3 条目超过 12 条不再被硬截断',
  Array.from({ length: 18 }, (_, i) => `${i + 1}. 第 ${i + 1} 条要点内容`).join('\n'),
  (r) =>
    r && r.items.length === 18 && r.truncated === false && r.omitted === 0
      ? true
      : { ok: false, detail: `items=${r && r.items.length} truncated=${r && r.truncated} omitted=${r && r.omitted}` }
)

checkShape(
  'G4 长条目拆成「标题 + 描述」，一个字都不丢',
  '1. 把等级推到 130 以上。这不是玄学，DLC 的敌人基础血量与伤害是按一个明确曲线拉的，中期配置会非常难受\n2. 圣杯瓶强化到 +8 以上。DLC 里的长距离探索段明显变多',
  (r) => {
    if (!r || r.items.length !== 2) return { ok: false, detail: `items=${r && r.items.length}` }
    const first = r.items[0]
    const full = (first.title || '') + (first.desc || '')
    return full.length > 40 && full.includes('明确曲线') && first.title.length <= 30
      ? true
      : { ok: false, detail: `title=「${first.title}」 desc 长度=${(first.desc || '').length}` }
  }
)

checkShape('G5 无导语时 intro 是空串（不是 undefined）', '1. 打开设置\n2. 调整画质\n3. 重启游戏', (r) =>
  r && r.intro === '' && r.truncated === false ? true : { ok: false, detail: `intro=${JSON.stringify(r && r.intro)}` }
)

console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
process.exit(fail === 0 ? 0 : 1)
