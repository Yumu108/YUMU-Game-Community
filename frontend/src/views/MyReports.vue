<template>
  <div class="page">
    <div class="wrap">
      <header class="page-head">
        <h1>我的举报</h1>
        <p class="sub">举报处理进度一目了然；被举报内容处理后会在此展示结果与处理说明。</p>
      </header>

      <!-- 状态过滤 -->
      <el-radio-group v-model="filterStatus" class="filter" @change="reload">
        <el-radio-button :value="null">全部</el-radio-button>
        <el-radio-button :value="0">待处理</el-radio-button>
        <el-radio-button :value="1">已处理(违规)</el-radio-button>
        <el-radio-button :value="2">已驳回</el-radio-button>
      </el-radio-group>

      <div v-if="loading" class="empty">
        <el-skeleton :rows="4" animated />
      </div>

      <div v-else-if="records.length === 0" class="empty">
        <el-empty description="还没有举报记录；遇到违规内容时点「举报」即可提交" />
      </div>

      <ul v-else class="report-list">
        <li v-for="r in records" :key="r.id" class="report-card">
          <div class="row1">
            <el-tag size="small" :type="tagType(r)" effect="light">{{ r.statusText }}</el-tag>
            <span class="type">举报{{ r.targetTypeText }}</span>
            <span class="title" :title="r.targetTitle">{{ r.targetTitle }}</span>
          </div>
          <div class="row2">
            <span class="reason">理由：{{ r.reason }}</span>
            <span class="time">{{ r.createdAt }}</span>
          </div>
          <div v-if="r.status !== 0" class="row3">
            <span class="note">处理说明：{{ r.handleNote || '无' }}</span>
          </div>
          <div v-if="r.postId" class="row4">
            <router-link class="link" :to="`/post/${r.postId}${r.replyId ? `?replyId=${r.replyId}` : ''}`">
              查看原文 →
            </router-link>
          </div>
        </li>
      </ul>

      <div v-if="total > size" class="pager">
        <el-pagination
          layout="prev, pager, next"
          :total="total"
          :page-size="size"
          :current-page="current"
          @current-change="onPage" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { listMyReports } from '@/api/community'

const loading = ref(true)
const records = ref([])
const total = ref(0)
const current = ref(1)
const size = 10
const filterStatus = ref(null)

function tagType(r) {
  if (r.status === 0) return 'warning'
  if (r.status === 1) return 'success'
  return 'info'
}

async function load() {
  loading.value = true
  try {
    const page = await listMyReports({ status: filterStatus.value, current: current.value, size })
    records.value = page.records
    total.value = page.total
  } finally {
    loading.value = false
  }
}

function reload() {
  current.value = 1
  load()
}

function onPage(p) {
  current.value = p
  load()
}

onMounted(load)
</script>

<style scoped>
.page { min-height: 100vh; background: #f6f5fb; padding: 24px 0 60px; }
.wrap { max-width: 820px; margin: 0 auto; padding: 0 16px; }
.page-head h1 { font-size: 24px; margin: 0 0 6px; color: #2b2350; }
.page-head .sub { color: #8b87a0; font-size: 13px; margin: 0 0 18px; }
.filter { margin-bottom: 16px; }
.empty { background: #fff; border-radius: 12px; padding: 32px; }
.report-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.report-card { background: #fff; border-radius: 12px; padding: 14px 16px; border: 1px solid #ece9f7; }
.report-card:hover { border-color: #c9bcf5; }
.row1 { display: flex; align-items: center; gap: 10px; }
.row1 .type { color: #6f6a8a; font-size: 13px; flex-shrink: 0; }
.row1 .title { font-weight: 600; color: #33305a; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row2 { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: 13px; }
.row2 .reason { color: #5c5878; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row2 .time { color: #a5a1b8; flex-shrink: 0; }
.row3 { margin-top: 8px; font-size: 13px; color: #3f8f5f; background: #f0faf4; border-radius: 6px; padding: 6px 10px; }
.row4 { margin-top: 8px; }
.link { color: #7c5cff; font-size: 13px; text-decoration: none; }
.link:hover { text-decoration: underline; }
.pager { display: flex; justify-content: center; margin-top: 20px; }
</style>
