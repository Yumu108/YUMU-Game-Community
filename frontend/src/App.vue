<template>
  <router-view />
  <AiAssistant />
</template>

<script setup>
// 根组件：承载路由视图 + 全局悬浮智能助手
import AiAssistant from './components/AiAssistant.vue';
</script>
