<script setup>
import { onLaunch, onShow } from '@dcloudio/uni-app'

onLaunch(() => {
  console.log('[YUMU] App Launch')
})
onShow(() => {
  console.log('[YUMU] App Show')
})
</script>

<style>
/* ============================================================
 * 全局主题令牌 —— 延续 YUMU 社区「深色 + 紫」视觉
 * 原型见 ../prototype/index.html，改色时两边一起改
 *
 * 🚨 2026-09-17 可读性修订：`--c-text-3` 原为 `#6f6a80`，对卡片底色 `#1a1725`
 *   只有 **3.39:1**，低于 WCAG AA 要求的 4.5:1（11px 小字最吃亏，元信息整行都读不清）。
 *   现提亮为 `#8b8599`（4.96:1）；`--c-text-2` 同步提到 `#a49eb6`（6.82:1），
 *   保持「主文字 > 次级 > 弱化」的层级**不倒挂**（原 text-3 比 text-2 还亮就会倒挂）。
 *   实测脚本：tests/probe-review.cjs（会打印每个选择器的实测对比度）。
 * ============================================================ */
page,
body {
  --c-bg: #0f0d16;          /* 页面底色 */
  --c-panel: #16131f;       /* 顶栏 / tabBar */
  --c-card: #1a1725;        /* 卡片 */
  --c-card-2: #221d33;      /* 强调卡片 / banner */
  --c-input: #231f31;       /* 输入框 / chip 底色 */
  --c-line: #2a2538;        /* 分隔线 / 卡片描边 */
  --c-line-2: #332c4a;      /* 强调卡片描边 */

  --c-primary: #7c5cff;     /* YUMU 紫 */
  --c-primary-dim: rgba(124, 92, 255, 0.2);
  --c-primary-soft: #b9a9ff;
  --c-primary-soft-2: #cbbdff;
  --c-teal: #19e3c2;        /* 电竞青 */
  --c-orange: #f0b45f;

  --c-text: #e9e7f2;        /* 主文字 */
  --c-text-2: #a49eb6;      /* 次级文字（对卡片底 ≥4.5:1） */
  --c-text-3: #8b8599;      /* 弱化文字（4.96:1，仍过 AA；别再往暗调） */

  background-color: #0f0d16;
  color: #e9e7f2;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  line-height: 1.5;
}

/* ---------------- H5 宽屏适配 ----------------
 * 本项目的**主交付渠道是 H5**（小程序不上架，见 README），而 uni-app 默认不给内容宽度上限：
 * 实测 1440px 桌面下帖子卡被拉到 1412px、标题行可用宽 1243px（一行上百个汉字，没法读）。
 * 这里只做「把阅读栏收窄居中」一件事，不做多列重排 —— 内容型阅读页窄栏更合适。
 * 证据与复跑：tests/probe-review.cjs 会打印 390 / 768 / 1440 三档的卡片宽度。
 */
/* #ifdef H5 */
@media (min-width: 768px) {
  .mp-page {
    max-width: 760px;
    margin-left: auto;
    margin-right: auto;
  }
}
/* #endif */

/* 横滑容器隐藏滚动条 */
::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

/* ---------------- 共享工具类 ---------------- */

/* 页面留白容器 */
.mp-page {
  min-height: 100vh;
  padding: 20rpx 28rpx 40rpx;
  box-sizing: border-box;
}

/* 通用卡片 */
.mp-card {
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 22rpx;
  margin-bottom: 18rpx;
  box-sizing: border-box;
}

/* 小标签 */
.mp-tag {
  display: inline-block;
  font-size: 20rpx;
  line-height: 1.6;
  padding: 0 12rpx;
  border-radius: 8rpx;
  background: rgba(25, 227, 194, 0.14);
  color: #19e3c2;
}
.mp-tag--purple {
  background: rgba(124, 92, 255, 0.2);
  color: #b9a9ff;
}
.mp-tag--orange {
  background: rgba(240, 159, 39, 0.15);
  color: #f0b45f;
}

/* 章节标题 */
.mp-sec {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 30rpx 0 16rpx;
}
.mp-sec__title {
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.mp-sec__more {
  font-size: 24rpx;
  color: #a49eb6;
}

/* 数字高亮（计数用） */
.mp-num {
  color: #b9a9ff;
  font-weight: 600;
}

/* 单行/两行截断 */
.mp-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
