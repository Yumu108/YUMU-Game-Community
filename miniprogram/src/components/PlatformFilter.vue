<template>
  <!--
    平台筛选按钮组 —— 本次定位调整的**核心交互**：
    「多平台游戏知识的聚合与分类展示」要靠这几个按钮才能被看见。

    设计要点：
      · 按钮大、选中态实心高亮，比原来的排序 chip 明显一档（那是「次要筛选」）；
      · 数字来自端内索引的真实计数，与筛出来的条数**必然一致**；
      · 横滑容器，档位增加也不会挤破布局。
  -->
  <view class="pf">
    <view v-if="title" class="pf__head">
      <text class="pf__title">{{ title }}</text>
      <text v-if="hint" class="pf__hint">{{ hint }}</text>
    </view>

    <scroll-view scroll-x class="pf__scroll" :show-scrollbar="false">
      <view class="pf__inner">
        <view
          v-for="t in tabs"
          :key="t.value === '' ? '__all__' : t.value"
          class="pf__btn"
          :class="{ 'pf__btn--on': value === t.value }"
          @click="pick(t.value)"
        >
          <text class="pf__label">{{ t.label }}</text>
          <text v-if="t.count != null" class="pf__count">{{ t.count }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
const props = defineProps({
  /** 当前选中值（'' = 全部） */
  value: { type: String, default: '' },
  /** [{ label, value, count }] */
  tabs: { type: Array, default: () => [] },
  title: { type: String, default: '' },
  hint: { type: String, default: '' }
})
const emit = defineEmits(['update:value', 'change'])

function pick(v) {
  if (v === props.value) return
  emit('update:value', v)
  emit('change', v)
}
</script>

<style scoped>
.pf {
  margin-bottom: 20rpx;
}
.pf__head {
  display: flex;
  align-items: baseline;
  margin-bottom: 14rpx;
}
.pf__title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--c-text, #e9e7f2);
}
.pf__hint {
  margin-left: 14rpx;
  font-size: 21rpx;
  /* 提亮后的弱化色，对卡片底色 ≥4.5:1（WCAG AA） */
  color: var(--c-text-3, #8b8599);
}

.pf__scroll {
  white-space: nowrap;
  width: 100%;
}
.pf__inner {
  display: inline-flex;
  padding: 4rpx 0 2rpx;
}
.pf__btn {
  flex: none;
  display: flex;
  align-items: baseline;
  height: 76rpx;
  padding: 0 32rpx;
  margin-right: 16rpx;
  border-radius: 38rpx;
  background: var(--c-input, #231f31);
  border: 2rpx solid transparent;
  box-sizing: border-box;
}
/* 🚨 uni-text 自带 white-space: pre-line，会把按钮里的文字挤到两行 */
.pf__btn > * {
  white-space: nowrap;
  line-height: 76rpx;
}
.pf__label {
  font-size: 28rpx;
  font-weight: 500;
  color: var(--c-text-2, #a49eb6);
}
.pf__count {
  margin-left: 10rpx;
  font-size: 21rpx;
  color: var(--c-text-3, #8b8599);
}

/* 选中态：实心高亮 + 描边，与未选中的灰底拉开明显层级 */
.pf__btn--on {
  background: var(--c-primary, #7c5cff);
  border-color: var(--c-primary-soft, #b9a9ff);
}
.pf__btn--on .pf__label {
  color: #ffffff;
  font-weight: 700;
}
.pf__btn--on .pf__count {
  color: rgba(255, 255, 255, 0.85);
}
</style>
