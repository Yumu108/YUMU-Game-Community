<template>
  <AppLayout hide-rail>
    <BackButton />
    <div class="editor">
      <!-- 左：编辑区 -->
      <div class="pane edit">
        <div class="section-title">{{ editingId ? '✏️ 编辑帖子' : '✍️ 发布帖子' }}</div>

        <!-- 被驳回帖重新编辑提示 -->
        <el-alert
          v-if="wasRejected"
          type="error"
          show-icon
          :closable="false"
          class="editor-alert"
          :title="rejectReasonText ? `该帖子未通过审核：${rejectReasonText}` : '该帖子未通过审核'"
          description="修改内容并保存后，帖子将自动重新提交审核。"
        />

        <label class="field">
          <span class="label">标题</span>
          <el-input v-model="form.title" placeholder="一句话说清你要聊什么" maxlength="60" show-word-limit />
        </label>

        <label class="field">
          <span class="label">所属板块</span>
          <el-select v-model="form.boardId" placeholder="选择板块" style="width: 100%">
            <el-option
              v-for="b in boardOptions"
              :key="b.id"
              :label="`${b.emoji} ${b.name}`"
              :value="b.id"
            />
          </el-select>
        </label>

        <label class="field">
          <span class="label">关联游戏（必选，冷门游戏请选「其他游戏」）</span>
          <el-select
            v-model="form.gameId"
            placeholder="搜索并选择游戏"
            filterable
            remote
            :remote-method="searchGames"
            :loading="gameLoading"
            style="width: 100%"
          >
            <el-option
              v-for="g in gameOptions"
              :key="g.id"
              :label="g.name"
              :value="g.id"
            />
          </el-select>
        </label>

        <!-- div 而非 label：点标签建议/空白处不应把点击转发进输入框 -->
        <div class="field">
          <span class="label">话题标签（最多 5 个，回车添加）</span>
          <div class="tag-editor">
            <span v-for="(t, i) in selectedTags" :key="t" class="chip">
              #{{ t }}
              <span class="chip-x" @click="removeTag(i)">×</span>
            </span>
            <input
              v-if="selectedTags.length < 5"
              v-model="tagInput"
              class="tag-input"
              placeholder="输入标签后回车"
              maxlength="30"
              list="tag-suggestions"
              @keydown.enter.prevent="addTag"
            />
            <datalist id="tag-suggestions">
              <option v-for="t in allTags" :key="t.id" :value="t.name" />
            </datalist>
          </div>
          <div v-if="allTags.length" class="tag-tip">
            热门标签（点击添加）：
            <span
              v-for="t in allTags.slice(0, 14)"
              :key="t.id"
              class="suggest"
              :class="{ disabled: selectedTags.includes(t.name) }"
              @click="quickAdd(t.name)"
            >#{{ t.name }}</span>
          </div>
        </div>

        <!-- div 而非 label：避免点击封面说明文字时误触发第一个预设封面按钮 -->
        <div class="field">
          <span class="label">封面（选填，将显示在帖子列表卡片右侧）</span>
          <!-- 实时预览 -->
          <div class="cover-preview">
            <img v-if="form.cover" :src="form.cover" class="cover-img" alt="cover" />
            <div v-else class="cover-empty">🎮 未设置封面（将使用默认图标）</div>
            <el-button
              v-if="form.cover"
              size="small"
              type="danger"
              plain
              @click="form.cover = ''"
            >清除封面</el-button>
          </div>
          <!-- 预设封面 -->
          <div class="cover-presets">
            <span class="cp-tip">点选预设：</span>
            <button
              v-for="c in presets"
              :key="c.url"
              type="button"
              class="cp-thumb"
              :class="{ active: form.cover === c.url }"
              @click="form.cover = c.url"
            >
              <img :src="c.url" :alt="c.name" />
            </button>
            <button type="button" class="cp-upload" @click="coverInput.click()">＋ 本地上传</button>
            <input
              ref="coverInput"
              type="file"
              accept="image/*"
              style="display: none"
              @change="onCoverPicked"
            />
          </div>
          <!-- 或填 URL -->
          <el-input
            v-model="form.cover"
            class="cover-url"
            placeholder="或粘贴图片地址（http/https）"
            clearable
          />
        </div>

        <!-- 用 div 不用 label：label 会把点击转发给内部第一个可聚焦控件，
             正文区这里是工具栏第一个按钮「图片」，点空白处会莫名弹出文件选择框 -->
        <div class="field">
          <span class="label">正文</span>
          <RichEditor v-model="form.content" />
        </div>

        <div class="actions">
          <el-button @click="reset">清空</el-button>
          <el-button type="primary" :loading="submitting" @click="publish">
            {{ editingId ? '保存修改' : '发布帖子' }}
          </el-button>
        </div>
      </div>

      <!-- 右：实时预览 -->
      <div class="pane preview">
        <div class="section-title">👁 实时预览</div>
        <div class="pv-card">
          <div class="pv-badges">
            <BoardTag v-if="selectedBoard" :text="selectedBoard.name" />
            <span v-for="t in selectedTags" :key="t" class="pv-tag">#{{ t }}</span>
          </div>
          <h2 class="pv-title">
            {{ form.title || '这里是标题预览' }}
          </h2>
          <div class="pv-meta">
            <el-avatar :size="24" class="pv-ava">🙂</el-avatar>
            <span>我</span>
            <span class="pv-board">{{ selectedBoard?.name || '未选择板块' }}</span>
          </div>
          <div class="pv-content" v-html="renderRichText(form.content) || '正文预览会显示在这里……'"></div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import BoardTag from '@/components/BoardTag.vue'
import RichEditor from '@/components/RichEditor.vue'
import { renderRichText, stripMarkdown } from '@/utils/richtext'
import { clearAllSnaps } from '@/utils/swrCache'
import { useUserStore, useGameStore } from '@/store'
import { addPost, updatePost, getPostDetail, getTags, uploadImage, getGames, getHotGames, getGameDetail } from '@/api/community'
import { FIXED_BOARDS } from '@/constants/boards'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const gameStore = useGameStore()
// 1.2：发帖板块固定为六种分类（与后端 board 表 id 1-6 对齐）
const boardOptions = ref(FIXED_BOARDS)
const form = ref({ title: '', boardId: '', content: '', cover: '', gameId: null })
// 编辑模式：从路由 ?edit={postId} 读取；为 null 时为「发布」模式，非 null 时为「编辑」模式
const editingId = ref(route.query.edit ? Number(route.query.edit) : null)
const submitting = ref(false)
const gameOptions = ref([])
const gameLoading = ref(false)
const selectedTags = ref([])
const tagInput = ref('')
const allTags = ref([])
const coverInput = ref(null)
// 被驳回帖重编状态：进入编辑页时根据帖子状态标记，提示用户保存后会自动重新提审
const wasRejected = ref(false)
const rejectReasonText = ref('')

const MAX_TAGS = 5

// 预设封面：public/covers 下的示例图
const presets = [
  { name: 'PC', url: '/covers/pc-game.svg' },
  { name: '手机', url: '/covers/mobile-game.svg' },
  { name: '主机', url: '/covers/console-game.svg' },
  { name: '新手', url: '/covers/newbie.svg' },
  { name: '创作', url: '/covers/creator.svg' },
  { name: '水区', url: '/covers/chat.svg' }
]

const selectedBoard = computed(() =>
  boardOptions.value.find((b) => b.id === form.value.boardId) || null
)

function addTag() {
  const name = tagInput.value.trim()
  if (!name) return
  if (name.length > 30) return ElMessage.warning('标签最多 30 个字')
  if (selectedTags.value.length >= MAX_TAGS) return ElMessage.warning('最多添加 5 个标签')
  if (selectedTags.value.includes(name)) {
    tagInput.value = ''
    return
  }
  selectedTags.value.push(name)
  tagInput.value = ''
}
function removeTag(i) {
  selectedTags.value.splice(i, 1)
}
function quickAdd(name) {
  if (selectedTags.value.includes(name)) return
  if (selectedTags.value.length >= MAX_TAGS) return ElMessage.warning('最多添加 5 个标签')
  selectedTags.value.push(name)
}

function reset() {
  form.value = { title: '', boardId: '', content: '', cover: '', gameId: null }
  selectedTags.value = []
  tagInput.value = ''
}

// 本地上传封面：上传到后端，返回 URL 存储（替代早期的 base64 内嵌）
async function onCoverPicked(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('封面图片过大（>10MB），请压缩后再上传')
    return
  }
  try {
    ElMessage.info('封面上传中…')
    const url = await uploadImage(file)
    form.value.cover = url
    ElMessage.success('封面上传成功')
  } catch (err) {
    // request 拦截器已统一弹错误提示
  }
}

async function publish() {
  if (!form.value.title.trim()) return ElMessage.warning('请先填写标题')
  if (!form.value.boardId) return ElMessage.warning('请选择所属板块')
  if (!form.value.gameId) return ElMessage.warning('请选择关联游戏（冷门游戏可选「其他游戏」）')
  const text = stripMarkdown(form.value.content)
  if (!text) return ElMessage.warning('正文不能为空')
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录后再发帖')
    return router.push('/login')
  }
  submitting.value = true
  try {
    const payload = {
      title: form.value.title.trim(),
      boardId: form.value.boardId,
      content: form.value.content.trim(),
      cover: form.value.cover || null,
      tags: selectedTags.value,
      gameId: form.value.gameId || null
    }
    if (editingId.value) {
      // 编辑模式：作者本人 / ADMIN；被驳回帖保存后自动重新提交审核（后端处理）
      const r = await updatePost(editingId.value, payload)
      if (!r?.id) {
        return ElMessage.error('保存失败：未返回帖子 ID')
      }
      ElMessage.success(r.resubmitted ? '修改已保存，帖子已重新提交审核，请耐心等待！' : '修改已保存！')
      clearAllSnaps()
      router.push(`/post/${r.id}`)
    } else {
      const post = await addPost(payload)
      if (!post?.id) {
        return ElMessage.error('发布失败：未返回帖子 ID')
      }
      ElMessage.success('发布成功！')
      // 列表 SWR 快照已过期（新帖不在缓存里），清掉避免跳回列表看到旧数据
      clearAllSnaps()
      router.push(`/post/${post.id}`)
    }
  } catch (e) {
    // request 拦截器已统一弹错误提示，这里不再重复；阻止跳转到 undefined 详情页
  } finally {
    submitting.value = false
  }
}

// 游戏远程搜索：与已选项合并去重，避免搜索结果覆盖当前选中项
async function searchGames(keyword) {
  if (!keyword || !keyword.trim()) return
  gameLoading.value = true
  try {
    const r = await getGames({ keyword: keyword.trim(), current: 1, size: 20 })
    const map = new Map()
    ;[...gameOptions.value, ...(r.records || [])].forEach((g) => map.set(g.id, g))
    gameOptions.value = [...map.values()]
  } catch (e) {
    // 静默失败，保留已有选项
  } finally {
    gameLoading.value = false
  }
}

onMounted(async () => {
  // 编辑模式：加载帖子数据回填表单
  if (editingId.value) {
    try {
      const p = await getPostDetail(editingId.value)
      if (p) {
        form.value = {
          title: p.title || '',
          boardId: p.boardId,
          content: p.content || '',
          cover: p.cover || '',
          gameId: p.gameId
        }
        selectedTags.value = (p.tags || []).map((t) => t.name)
        // 被驳回帖（status=1 且带驳回理由）重新编辑：顶部给出提示
        wasRejected.value = p.status === 1 && !!p.rejectReason
        if (wasRejected.value) rejectReasonText.value = p.rejectReason || ''
        // 把当前游戏加入选项（确保下拉可见）
        if (p.gameId && !gameOptions.value.some((g) => g.id === p.gameId)) {
          try {
            const g = await getGameDetail(p.gameId)
            if (g) gameOptions.value = [g, ...gameOptions.value]
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {
      // 拦截器已提示
    }
  }
  // 1.2：发帖板块固定为六种分类（常量已提供），无需再从后端拉取板块树
  // 游戏库（便于发帖时关联游戏）：默认载入「其他游戏」(id=1) + 热门游戏，并支持远程搜索
  try {
    const otherGame = await getGameDetail(1) // 其他游戏：冷门游戏兜底项
    let hot = []
    try {
      hot = await getHotGames(20)
    } catch (e) {
      hot = []
    }
    const merged = new Map()
    if (otherGame) merged.set(otherGame.id, otherGame)
    ;(hot || []).forEach((g) => {
      if (g.id !== otherGame?.id) merged.set(g.id, g)
    })
    gameOptions.value = [...merged.values()]
    // 预选优先级：全局选中的游戏 > 路由 ?gameId > 默认「其他游戏」
    let prefillId = null
    if (gameStore.currentGameId) prefillId = gameStore.currentGameId
    else if (route.query.gameId) prefillId = Number(route.query.gameId)
    if (prefillId && gameOptions.value.some((g) => g.id === prefillId)) {
      form.value.gameId = prefillId
    } else if (!form.value.gameId) {
      form.value.gameId = otherGame ? otherGame.id : null
    }
  } catch (e) {
    gameOptions.value = []
  }
  // 加载可选标签（用于发帖页热词联想）
  try {
    allTags.value = await getTags()
  } catch (e) {
    allTags.value = []
  }
})
</script>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.editor-alert {
  margin-bottom: 14px;
}
.pane {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
}
.field {
  display: block;
  margin-bottom: 16px;
}
.label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--t2);
  margin-bottom: 7px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}
/* 封面设置 */
.cover-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.cover-img {
  width: 86px;
  height: 64px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--border);
  background: var(--bg-3);
}
.cover-empty {
  width: 86px;
  height: 64px;
  border-radius: 10px;
  border: 1px dashed var(--border);
  display: grid;
  place-items: center;
  font-size: 13px;
  color: var(--t3);
  background: var(--bg-3);
}
.cover-presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cp-tip {
  font-size: 12px;
  color: var(--t3);
}
.cp-thumb {
  width: 48px;
  height: 36px;
  border-radius: 8px;
  border: 2px solid transparent;
  overflow: hidden;
  padding: 0;
  cursor: pointer;
  background: var(--bg-3);
}
.cp-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cp-thumb.active {
  border-color: var(--brand);
}
.cp-upload {
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px dashed var(--border);
  background: var(--bg-3);
  color: var(--t2);
  cursor: pointer;
  font-size: 12.5px;
}
.cp-upload:hover {
  border-color: var(--brand);
  color: var(--t1);
}
.cover-url {
  max-width: 420px;
}
/* 标签编辑器 */
.tag-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-1);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(124, 92, 255, 0.16);
  color: #c4b5ff;
  font-size: 12.5px;
  font-weight: 600;
}
.chip-x {
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.75;
}
.chip-x:hover {
  opacity: 1;
  color: #fff;
}
.tag-input {
  flex: 1;
  min-width: 120px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--t1);
  font-size: 13px;
}
.tag-tip {
  margin-top: 9px;
  font-size: 12px;
  color: var(--t3);
  line-height: 2;
}
.suggest {
  display: inline-block;
  margin: 0 6px 0 0;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--t2);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.suggest:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.suggest.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pv-tag {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(124, 92, 255, 0.16);
  color: #c4b5ff;
  font-size: 12px;
  font-weight: 600;
}
/* 预览 */
.pv-card {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  min-height: 320px;
}
.pv-badges {
  margin-bottom: 10px;
}
.pv-title {
  margin: 0 0 12px;
  font-size: 19px;
  font-weight: 800;
  color: var(--t1);
  line-height: 1.4;
}
.pv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--t3);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}
.pv-ava {
  background: var(--bg-3);
  font-size: 13px;
}
.pv-board {
  color: var(--brand);
}
.pv-content {
  font-size: 14px;
  line-height: 1.8;
  color: var(--t2);
  white-space: pre-wrap;
  word-break: break-word;
}
/* 富文本图片尺寸规范：避免大图撑爆预览面板 */
.pv-content :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 360px;
  width: auto;
  height: auto;
  margin: 10px 0;
  border-radius: 8px;
  background: var(--bg-3);
  object-fit: contain;
}
@media (max-width: 900px) {
  .editor {
    grid-template-columns: 1fr;
  }
}
</style>
