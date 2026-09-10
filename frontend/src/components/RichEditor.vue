<template>
  <div class="rich-editor" :class="{ 'hover-off': hoverOff }">
    <div class="re-toolbar">
      <button type="button" class="re-btn" title="插入图片" @click="insertImage">🖼 图片</button>
      <button type="button" class="re-btn" title="插入链接" @click="insertLink">🔗 链接</button>
      <button type="button" class="re-btn" title="输入 @ 可选择用户提及" @click="focusAndInsertAt">@ 提及</button>
      <span class="re-hint">正文为纯文本 + 安全标记语法；中文/标点后直接输 @ 提及用户（紧跟字母数字先打空格，防误判邮箱）；@提及是整体，点击/删除按整体处理；提及后对方会收到通知</span>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="onFilePicked"
      />
    </div>

    <!-- 正文编辑区（相对定位承载 @ 补全浮层 + 装饰层） -->
    <div class="re-body-wrap">
      <!-- 9-07（回退版）：textarea + 装饰层（与上一轮一致）—— textarea 透明 + 装饰层 div 把 markdown 解析为显示视图
           字符数 1:1 对齐（visibility:hidden 占位），让光标位置正确 -->
      <textarea
        ref="editorEl"
        class="re-body"
        :value="modelValue"
        :placeholder="placeholder"
        @input="onInput"
        @keydown="onKeydown"
        @keyup="onKeyup"
        @scroll="onEditorScroll"
        @select="onTaSelect"
        @paste="onPaste"
        spellcheck="false"
      ></textarea>
      <div ref="decoEl" class="re-deco" v-html="decorationHtml" aria-hidden="true" @mousedown.prevent @click="onDecoClick"></div>
      <!-- 空内容占位符：textarea 透明化后原生 placeholder 不可见，改由装饰层承载 -->
      <div v-if="!modelValue" class="re-deco re-placeholder">{{ placeholder }}</div>

      <!-- @自动补全浮层（9-07） -->
      <div v-if="mentionOpen" class="mention-pop">
        <div class="mp-title">@ 用户（方向键 ↑↓ / 回车选择 / Esc 关闭）</div>
        <template v-if="mentionLoading">
          <div class="mp-row mp-tip">搜索中…</div>
        </template>
        <template v-else-if="mentionItems.length">
          <div
            v-for="(it, i) in mentionItems"
            :key="it.id"
            class="mp-row"
            :class="{ on: i === mentionIdx }"
            @mouseenter="mentionIdx = i"
            @mousedown.prevent="selectMention(it)"
          >
            <el-avatar :size="22" :src="it.avatar" class="mp-ava">{{ (it.name || '?').charAt(0) }}</el-avatar>
            <span class="mp-name">{{ it.name }}</span>
          </div>
        </template>
        <template v-else>
          <div class="mp-row mp-tip">{{ mentionQuery ? '没有找到匹配的用户，继续输入试试' : '输入用户昵称关键字进行搜索' }}</div>
        </template>
      </div>
    </div>

    <div v-if="imageCount" class="re-attach">
      <span class="re-attach-tip">已插入 {{ imageCount }} 张图片（发布后显示）</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { uploadImage, search } from '@/api/community'
import { mentionMarkdown, decorationHtmlFor } from '@/utils/richtext'

const router = useRouter()

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '写点什么吧……可插入图片与链接' }
})
const emit = defineEmits(['update:modelValue'])

// ---------------- 9-07：装饰层（textarea 透明 + 上层高亮 div） ----------------
// 字符数严格 1:1（hidden span 也算字符宽度），保证光标位置与 textarea 字符串索引一致
const decorationHtml = computed(() => decorationHtmlFor(props.modelValue))

const editorEl = ref(null)
const decoEl = ref(null)
const fileInput = ref(null)

const imageCount = computed(
  () => (props.modelValue.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length
)

// ---------------- 滚动驻留 hover 抑制 ----------------
// 现象：鼠标不动、只滚动页面时，工具栏按钮会"自己亮"——内容在静止指针下方移动，
// 滚停后按钮恰好停在指针底下，浏览器按指针位置重算 :hover。
// 方案：检测到滚轮滚动就挂起 hover 高亮（hover-off），直到指针真正 mousemove 才恢复；
// 这样按钮只会在"真的把鼠标移上去"时才亮。
const hoverOff = ref(true)
function onWindowWheel() {
  hoverOff.value = true
}
function onWindowMouseMove() {
  if (hoverOff.value) hoverOff.value = false
}
onMounted(() => {
  window.addEventListener('wheel', onWindowWheel, { passive: true })
  window.addEventListener('mousemove', onWindowMouseMove, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('wheel', onWindowWheel)
  window.removeEventListener('mousemove', onWindowMouseMove)
})

function onInput(e) {
  emit('update:modelValue', e.target.value)
  updateMentionTrigger(e.target, { fromInput: true })
}
// 装饰层与 textarea 滚动同步（字符数 1:1，滚动条高度一致）
function onEditorScroll(e) {
  if (decoEl.value) decoEl.value.scrollTop = e.target.scrollTop
}

// 装饰层链接点击：站内链接走 router，外链新窗口
function onDecoClick(e) {
  const a = e.target.closest && e.target.closest('a')
  if (!a) return
  e.stopPropagation()
  const href = a.getAttribute('href') || ''
  if (href.startsWith('/user/') || href.startsWith('/search') || href.startsWith('/post/') || href.startsWith('/board/') || href.startsWith('/game/')) {
    e.preventDefault()
    router.push(href)
  }
}

function onKeyup(e) {
  // 仅 Backspace / Delete 在 keyup 里重新判定（删除键可能不触发 onInput）。
  // 方向键/Enter/Esc 不应触发 updateMentionTrigger —— 它们的语义是"改 idx / 选中"，
  // 触发后会重置 mentionIdx 造成"按一下跳回第一条"的 bug。
  if (e.key === 'Backspace' || e.key === 'Delete') {
    updateMentionTrigger(e.target, { fromInput: false })
  }
}

// ---------------- @提及原子化（9-08） ----------------
// 提及 [@昵称](/user/N) 在编辑视图中是一个"整体"（微信/B站同款行为）：
//   - 退格/删除 → 删掉整个提及；←/→ → 整体跳过
//   - 点击落在提及内部 → 选中整个提及（语法字符不可见，部分定位无意义）
//   - 选区/粘贴与提及部分重叠 → 自动扩展为整个提及再操作
// 防篡改兜底：即使被改坏，保存时后端 canonicalizeMentions 会规范化/降级。
const MENTION_TOKEN_SRC = '\\[[^\\]]*\\]\\(\\/user\\/\\d+\\)'

function findMentionTokens(src) {
  const list = []
  const re = new RegExp(MENTION_TOKEN_SRC, 'g')
  let m
  while ((m = re.exec(src || '')) !== null) {
    list.push({ start: m.index, end: m.index + m[0].length })
  }
  return list
}

/** pos 是否落在某提及内部（不含两端） */
function tokenStrictlyAt(tokens, pos) {
  return tokens.find((t) => pos > t.start && pos < t.end) || null
}

/** 把选区 [s,e) 中与提及部分重叠（未完整覆盖）的部分扩展为完整提及 */
function expandSelToTokens(tokens, s, e) {
  let ns = s
  let ne = e
  for (const t of tokens) {
    const overlaps = ns < t.end && ne > t.start
    const fullyInside = ns <= t.start && ne >= t.end
    if (overlaps && !fullyInside) {
      ns = Math.min(ns, t.start)
      ne = Math.max(ne, t.end)
    }
  }
  return [ns, ne]
}

/** 应用一次编辑并同步 v-model（光标落在替换内容之后） */
function applyEdit(start, end, replacement) {
  const ta = editorEl.value
  if (!ta) return
  const next = ta.value.slice(0, start) + replacement + ta.value.slice(end)
  ta.value = next
  emit('update:modelValue', next)
  const pos = start + replacement.length
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos) })
}

/**
 * 提及整体化按键接管。返回 true 表示已接管（阻止默认行为）。
 * 注意：IME 组合中（isComposing/229）绝不接管，否则破坏中文输入法。
 */
function handleTokenKeydown(e) {
  const ta = editorEl.value
  if (!ta) return false
  if (e.isComposing || e.keyCode === 229) return false
  const tokens = findMentionTokens(ta.value)
  if (!tokens.length) return false
  const s = ta.selectionStart ?? 0
  const en = ta.selectionEnd ?? 0

  if (e.key === 'Backspace' || e.key === 'Delete') {
    // 选区与提及部分重叠 → 扩成整体后整体删除
    if (s !== en) {
      const [ns, ne] = expandSelToTokens(tokens, s, en)
      if (ns !== s || ne !== en) {
        e.preventDefault()
        applyEdit(ns, ne, '')
        return true
      }
      return false
    }
    // 光标在提及内部 → 删整体
    const inside = tokenStrictlyAt(tokens, s)
    if (inside) { e.preventDefault(); applyEdit(inside.start, inside.end, ''); return true }
    // 光标贴边：Backspace 在右端 / Delete 在左端 → 删整体
    if (e.key === 'Backspace') {
      const t = tokens.find((x) => x.end === s)
      if (t) { e.preventDefault(); applyEdit(t.start, t.end, ''); return true }
    } else {
      const t = tokens.find((x) => x.start === s)
      if (t) { e.preventDefault(); applyEdit(t.start, t.end, ''); return true }
    }
    return false
  }

  if (s === en && e.key === 'ArrowLeft') {
    // 在提及内部或右端 → 跳到左端（整体跳过）
    const t = tokens.find((x) => (s > x.start && s < x.end) || s === x.end)
    if (t) { e.preventDefault(); ta.setSelectionRange(t.start, t.start); return true }
    return false
  }
  if (s === en && e.key === 'ArrowRight') {
    // 在提及内部或左端 → 跳到右端（整体跳过）
    const t = tokens.find((x) => (s > x.start && s < x.end) || s === x.start)
    if (t) { e.preventDefault(); ta.setSelectionRange(t.end, t.end); return true }
    return false
  }
  return false
}

/** 光标落在提及内部 → 选中整个提及（语法字符不可见，停在中间只会造成困惑） */
function onTaSelect() {
  const ta = editorEl.value
  if (!ta) return
  const s = ta.selectionStart ?? 0
  const en = ta.selectionEnd ?? 0
  if (s !== en) return
  const tokens = findMentionTokens(ta.value)
  const t = tokenStrictlyAt(tokens, s)
  if (t) ta.setSelectionRange(t.start, t.end)
}

/** 粘贴选区部分覆盖提及 → 扩成整体后替换（整段提及被剪贴板内容替换） */
function onPaste(e) {
  const ta = editorEl.value
  if (!ta) return
  const s = ta.selectionStart ?? 0
  const en = ta.selectionEnd ?? 0
  if (s === en) return
  const tokens = findMentionTokens(ta.value)
  if (!tokens.length) return
  const [ns, ne] = expandSelToTokens(tokens, s, en)
  if (ns === s && ne === en) return
  e.preventDefault()
  const text = e.clipboardData ? e.clipboardData.getData('text/plain') : ''
  applyEdit(ns, ne, text)
}

// ---------------- @ 自动补全（9-07） ----------------
const mentionOpen = ref(false)
const mentionLoading = ref(false)
const mentionItems = ref([])
const mentionIdx = ref(0)
const mentionQuery = ref('')
let mentionStart = -1
let searchSeq = 0
let searchTimer = null

function closeMention() {
  mentionOpen.value = false
  mentionLoading.value = false
  mentionItems.value = []
  mentionStart = -1
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null }
}

/** 从光标位置向前匹配最后一段 @xxx（@ 与光标间无空白），命中则打开补全。
 *  边界规则（防邮箱误判）：@ 前一个字符是「英文字母/数字/邮箱符号」时不触发
 *  （如 test@qq.com）；中文、中文标点、空格、行首等场景直接触发。 */
function updateMentionTrigger(ta, { fromInput = false } = {}) {
  if (!ta) return
  const pos = ta.selectionStart ?? ta.value.length
  const before = ta.value.slice(0, pos)
  const m = before.match(/@([^\s@]*)$/)
  if (!m) { closeMention(); return }
  mentionStart = m.index
  if (mentionStart > 0 && /[A-Za-z0-9._%+\-@]/.test(before[mentionStart - 1])) { closeMention(); return }
  const kw = m[1] || ''
  mentionOpen.value = true
  if (fromInput) mentionIdx.value = 0
  searchMentions(kw)
}

function searchMentions(kw) {
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null }
  mentionQuery.value = kw
  const seq = ++searchSeq
  searchTimer = setTimeout(async () => {
    mentionLoading.value = true
    try {
      const res = await search({ keyword: kw.trim(), type: 'user', size: 8 })
      if (seq !== searchSeq) return
      mentionItems.value = (res?.users || []).map((u) => ({
        id: u.id,
        name: u.name || '未知',
        avatar: u.avatar || ''
      }))
      if (mentionIdx.value >= mentionItems.value.length) {
        mentionIdx.value = Math.max(0, mentionItems.value.length - 1)
      }
    } catch (e) {
      if (seq === searchSeq) mentionItems.value = []
    } finally {
      if (seq === searchSeq) mentionLoading.value = false
    }
  }, 180)
}

function onKeydown(e) {
  // 9-08：@提及整体化按键优先（退格/删除/左右方向键按整体处理）
  if (handleTokenKeydown(e)) return
  if (!mentionOpen.value) return
  const items = mentionItems.value
  if (e.key === 'ArrowDown') {
    if (items.length) { e.preventDefault(); mentionIdx.value = (mentionIdx.value + 1) % items.length }
  } else if (e.key === 'ArrowUp') {
    if (items.length) { e.preventDefault(); mentionIdx.value = (mentionIdx.value - 1 + items.length) % items.length }
  } else if (e.key === 'Enter') {
    const it = items[mentionIdx.value]
    if (it) { e.preventDefault(); selectMention(it) }
  } else if (e.key === 'Escape') {
    closeMention()
  }
}

/** 选中：把 @xxx 替换成 [@昵称](/user/123)，光标移到 ")" 后 */
function selectMention(it) {
  const ta = editorEl.value
  if (!ta || !Number.isInteger(mentionStart)) { closeMention(); return }
  const snippet = mentionMarkdown(it.name, it.id)
  const next = ta.value.slice(0, mentionStart) + snippet + ta.value.slice(ta.selectionEnd ?? mentionStart)
  ta.value = next
  emit('update:modelValue', next)
  closeMention()
  const pos = mentionStart + snippet.length
  ta.focus()
  requestAnimationFrame(() => { ta.setSelectionRange(pos, pos) })
}

// 点击工具栏「@ 提及」：在光标处插入一个 @ 并唤起补全
function focusAndInsertAt() {
  const ta = editorEl.value
  if (!ta) return
  ta.focus()
  insertAtCursor('@')
  requestAnimationFrame(() => updateMentionTrigger(ta))
}

// ---------------- 通用插入 ----------------
function insertAtCursor(snippet) {
  const ta = editorEl.value
  if (!ta) {
    emit('update:modelValue', (props.modelValue || '') + snippet)
    return
  }
  const s = ta.selectionStart ?? ta.value.length
  const en = ta.selectionEnd ?? ta.value.length
  const val = ta.value
  const next = val.slice(0, s) + snippet + val.slice(en)
  ta.value = next
  const pos = s + snippet.length
  ta.focus()
  ta.setSelectionRange(pos, pos)
  emit('update:modelValue', next)
}

function insertLink() {
  const url = window.prompt('输入链接地址（http/https）：', 'https://')
  if (!url) return
  const label = window.prompt('链接文字（可留空，默认显示链接地址）：', '') || ''
  const text = label ? `[${label}](${url})` : `[${url}](${url})`
  insertAtCursor(text)
}

function insertImage() {
  fileInput.value?.click()
}

async function onFilePicked(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('图片过大（>10MB），请压缩后再上传')
    return
  }
  try {
    ElMessage.info('图片上传中…')
    const url = await uploadImage(file)
    insertAtCursor(`![图片](${url})`)
    ElMessage.success('图片已插入')
  } catch (err) {
    // request 拦截器已统一弹错误提示
  }
}
</script>

<style scoped>
.rich-editor {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-1);
}
.re-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-3);
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.re-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-1);
  color: var(--t1);
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}
.re-btn:hover {
  border-color: var(--brand);
  color: var(--brand);
}
/* 滚动驻留抑制：滚轮滚动后、鼠标未真正移动前，不给工具栏按钮 hover 高亮，
   避免内容滚到指针下方时按钮"自己亮" */
.rich-editor.hover-off .re-btn:hover {
  border-color: var(--border);
  color: var(--t1);
}
.re-hint {
  font-size: 12px;
  color: var(--t3);
  margin-left: 4px;
}
.re-body-wrap {
  position: relative;
}
/* 9-07 回退版：textarea 透明叠加装饰层（字符数 1:1 对齐，光标索引一致） */
.re-body {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 280px;
  max-height: 560px;
  overflow-y: auto;
  padding: 14px 16px;
  border: 0;
  outline: none;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.8;
  /* 透明化：仅显示上层装饰层（@昵称/链接蓝色、图片标签），不再裸显 markdown 原文 */
  color: transparent;
  -webkit-text-fill-color: transparent;
  caret-color: var(--t1);
  background: transparent;
  position: relative;
  z-index: 1;
}
/* 装饰层：与 textarea 同字体/行高/内边距，1:1 覆盖对齐；链接可点（pointer-events:auto） */
.re-deco {
  position: absolute;
  inset: 0;
  padding: 14px 16px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.8;
  color: var(--t1);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  pointer-events: none;
  z-index: 2;
}
.re-placeholder {
  color: var(--t3);
}
/* 装饰层 @提及 / 站内链接：蓝色加粗 */
.deco-link {
  color: var(--brand);
  font-weight: 600;
  text-decoration: none;
  pointer-events: auto;
  cursor: pointer;
}
.deco-link:hover {
  text-decoration: underline;
}
/* 图片标签 */
.deco-img {
  display: inline-block;
  background: rgba(124, 92, 255, 0.12);
  color: var(--brand);
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12.5px;
  user-select: none;
}
/* markdown 语法段（[ ] ( ) 等）保留占位宽度但不可见 */
.deco-hidden {
  color: var(--t1);
}
.re-attach {
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-3);
}
.re-attach-tip {
  font-size: 12px;
  color: var(--t3);
}
/* 9-07：@ 自动补全浮层（吸附 textarea 顶部工具栏下方右侧，避免大面积遮挡正文） */
.mention-pop {
  position: absolute;
  top: 6px;
  right: 10px;
  width: 280px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 60;
  padding: 6px;
}
.mp-title {
  font-size: 11px;
  color: var(--t3);
  padding: 2px 6px 6px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 4px;
}
.mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--t1);
}
.mp-row.on {
  background: var(--brand);
  color: #fff;
}
.mp-row.on .mp-sub {
  color: rgba(255, 255, 255, 0.8);
}
.mp-ava {
  background: var(--bg-3);
  flex: none;
}
.mp-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-sub {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--t3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
}
.mp-tip {
  color: var(--t3);
  cursor: default;
  font-size: 12.5px;
  justify-content: center;
}
</style>