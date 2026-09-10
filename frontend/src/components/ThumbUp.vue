<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :class="['thumb-up', { active }]"
    aria-hidden="true"
  >
    <!-- 大拇指向上图标 -->
    <path
      d="M7 22H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3v11zm0-11h4.59l1.7-5.45a1 1 0 0 1 1.9.55v5.9H20a2 2 0 0 1 2 2.17l-1.5 7a2 2 0 0 1-2 1.83H7V11z"
      fill="currentColor"
    />
  </svg>
</template>

<script setup>
defineProps({
  size: { type: [Number, String], default: 16 },
  active: { type: Boolean, default: false }
})
</script>

<style scoped>
.thumb-up {
  display: inline-block;
  vertical-align: -2px;
  transition: transform 0.18s ease;
}
.thumb-up.active {
  color: #ff5b6f;
  transform: scale(1.08);
}
</style>