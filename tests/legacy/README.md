# tests/legacy —— 历史阶段脚本（已归档，不再维护）

本目录存放**早期开发阶段（Phase 6 ~ Phase 11）**编写的一次性验证脚本。它们已被后来更完整、
更稳定的套件取代，**保留仅为追溯历史**，不保证能在当前代码上通过。

## ⚠️ 为什么要归档它们

这些脚本写于「板块还有父子层级」「后台还是旧结构」的年代，依赖的契约后来变了：

| 脚本 | 依赖的旧契约 | 现在的状况 |
|---|---|---|
| `phase11-verify.mjs` | 父子板块层级（`tree[].children[]`） | **9-05 取消板块细分** → 直接 TypeError |
| `phase7-admin-enhance-verify.mjs` | 旧的板块/用户管理接口细节 | 多处断言已漂移 |
| `phase8-verify.mjs`、`phase9-verify.mjs` | 旧徽章 / 公告字段 | 少量断言漂移 |
| `phase6-admin-verify.mjs`、`phase6-audit-verify.mjs` | 需人工 `setup` + 外部 SQL 提升 ADMIN | 工作流已废弃 |
| `phase6-verify.mjs` | Phase 6 专项 | 覆盖已被 api-e2e / reply-image 取代 |
| `verify-scroll.mjs` | 3 行备忘（不可执行） | 仅历史注记 |

一个「跑起来必然报错」的僵尸脚本比没有脚本更糟：它会让人误判成新引入的回归。

## ✅ 请改用这些现行套件

| 领域 | 现行脚本（在 `tests/`） |
|---|---|
| 全量接口回归 | `api-e2e-test.mjs`（74） |
| 各功能专项 | `tests/*-verify.mjs`（30+ 个，见 `项目功能与运行逻辑说明.md`） |
| 排序 / 分页 / 跨页稳定 | `sort-verify.mjs`（40） |
| 板块契约 / 计数同步 | `board-aggregate-verify.mjs`、`board-count-sync-verify.mjs` |
| 智能助手 | `ai-chat-verify.mjs`、`ai-deepseek-live-verify.mjs` |
| 浏览器 UI 回归 | `tests/.pw/*.js`（playwright-core + 系统 Chrome） |

## 📌 如果要复活其中某个脚本

1. 先读 `项目功能与运行逻辑说明.md` 确认现行契约（尤其板块已**扁平化**、版主授权以**游戏**为粒度）；
2. 把断言改成按实际数据动态取值，**不要写死 boardId / gameId / 昵称**；
3. 移回 `tests/` 并在文首注明它守护的契约。
