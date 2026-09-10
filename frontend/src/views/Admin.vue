<template>
  <AppLayout>
    <BackButton />
    <div class="admin">
      <div class="a-head">
        <h1 class="a-title">🛡️ 管理 / 审核后台</h1>
        <p class="a-sub">
          处理用户举报、审核帖子、管理用户角色与版主分配（权限由后端校验：版主负责某个游戏的全部板块并享有加精权限，置顶仅管理员）。
        </p>
      </div>

      <el-alert
        v-if="!userStore.canModerate"
        type="error"
        :closable="false"
        title="无权限"
        description="当前账号没有管理 / 审核权限，无法使用后台。"
      />

      <template v-else>
        <el-tabs v-model="activeTab" class="a-tabs" @tab-change="onTabChange">
          <el-tab-pane label="举报队列" name="reports" />
          <el-tab-pane label="帖子审核" name="posts" />
          <el-tab-pane v-if="userStore.isAdmin" label="用户管理" name="users" />
          <el-tab-pane v-if="userStore.isAdmin" label="游戏管理" name="games" />
          <el-tab-pane v-if="userStore.isAdmin" label="公告管理" name="announcements" />
        </el-tabs>

        <!-- ================= 举报队列 ================= -->
        <div v-if="activeTab === 'reports'" class="a-section reports-section">
          <div class="a-section-head">
            <div class="a-section-title">🚨 举报队列</div>
            <div class="a-section-desc">这里是社区成员举报的违规内容，由当前账号或更高级别管理员处理。</div>
          </div>
          <el-tabs v-model="reportTab" class="a-subtabs" @tab-change="loadReports">
            <el-tab-pane label="待处理" name="0" />
            <el-tab-pane label="已处理(违规)" name="1" />
            <el-tab-pane label="已驳回" name="2" />
            <el-tab-pane label="全部" name="all" />
          </el-tabs>
          <div v-if="rLoading" class="a-loading"><el-skeleton :rows="4" animated /></div>
          <div v-else-if="!reportList.records.length" class="a-empty">暂无相关举报 🎉</div>
          <div v-else class="a-list">
            <div v-for="r in reportList.records" :key="r.id" class="a-item">
              <div class="a-item-main">
                <div class="a-item-top">
                  <span class="a-tag" :class="`t${r.targetType}`">{{ r.targetTypeText }}</span>
                  <span class="a-target" v-if="r.targetTitle">「{{ r.targetTitle }}」</span>
                  <span class="a-id num">#{{ r.id }}</span>
                  <span class="a-time num">{{ r.createdAt }}</span>
                </div>
                <div class="a-reason">
                  <b>{{ r.reporterName }}</b> 举报理由：{{ r.reason }}
                </div>
                <div v-if="r.status !== 0" class="a-handled">
                  处理结果：<b>{{ r.statusText }}</b>
                  <span v-if="r.handleNote">（备注：{{ r.handleNote }}）</span>
                </div>
              </div>
              <div class="a-item-actions">
                <!-- 9-07：每条举报加「查看原文」入口（帖子/回复/用户跳不同位置） -->
                <el-button
                  v-if="r.targetType === 1 && r.postId"
                  size="small"
                  plain
                  @click="openTarget(r)"
                >查看帖子</el-button>
                <el-button
                  v-else-if="r.targetType === 2 && r.postId"
                  size="small"
                  plain
                  @click="openTarget(r)"
                >查看回复</el-button>
                <el-button
                  v-else-if="r.targetType === 3"
                  size="small"
                  plain
                  @click="openTarget(r)"
                >查看用户</el-button>
                <el-input v-if="r.status === 0" v-model="notes[r.id]" size="small" class="a-note" placeholder="处理备注（可选）" />
                <el-button v-if="r.status === 0" type="danger" size="small" @click="submitReportReq(r.id, 1)">标记违规</el-button>
                <el-button v-if="r.status === 0" size="small" @click="submitReportReq(r.id, 2)">驳回</el-button>
              </div>
            </div>
          </div>
          <el-pagination
            v-if="reportList.total > reportList.size"
            class="a-page"
            layout="prev, pager, next"
            :total="reportList.total"
            :page-size="reportList.size"
            :current-page="reportList.current"
            @current-change="(p) => loadReports(reportTab, p)"
          />
        </div>

        <!-- ================= 帖子审核 ================= -->
        <div v-else-if="activeTab === 'posts'" class="a-section posts-section">
          <div class="a-section-head">
            <div class="a-section-title">📝 帖子审核</div>
            <div class="a-section-desc">查看帖子内容，判断是否违规 → 通过发布或驳回（驳回会通知发帖人）。</div>
          </div>
          <!-- 帖子审核右上：状态筛选 + 待审优先 -->
          <div class="a-filters">
            <el-select v-if="userStore.isAdmin" v-model="postFilter.boardId" placeholder="全部板块" clearable size="small" class="a-filter" @change="loadPosts(1)">
              <el-option v-for="b in allBoardOptions" :key="b.id" :label="b.name" :value="b.id" />
            </el-select>
            <el-radio-group v-model="postFilter.status" size="small" class="a-filter-seg" @change="loadPosts(1)">
              <el-radio-button :label="2">待审核</el-radio-button>
              <el-radio-button :label="0">可见</el-radio-button>
              <el-radio-button :label="1">已隐藏/驳回</el-radio-button>
            </el-radio-group>
            <el-radio-group v-model="postFilter.order" size="small" class="a-filter-seg" @change="loadPosts(1)">
              <el-radio-button label="desc">最新优先</el-radio-button>
              <el-radio-button label="asc">最旧优先</el-radio-button>
            </el-radio-group>
            <el-select v-model="postFilter.days" placeholder="时间窗" clearable size="small" class="a-filter-days" @change="loadPosts(1)">
              <el-option label="不限" :value="null" />
              <el-option label="最近 1 天" :value="1" />
              <el-option label="最近 3 天" :value="3" />
              <el-option label="最近 7 天" :value="7" />
              <el-option label="最近 30 天" :value="30" />
            </el-select>
          </div>
          <div v-if="pLoading" class="a-loading"><el-skeleton :rows="5" animated /></div>
          <div v-else-if="!postList.records.length" class="a-empty">暂无帖子</div>
          <div v-else class="a-list">
            <div v-for="p in postList.records" :key="p.id" class="a-item a-post">
              <div class="a-item-main">
                <div class="a-item-top">
                  <el-tag v-if="p.isTop" size="small" type="warning" effect="dark">置顶</el-tag>
                  <el-tag v-if="p.isEssence" size="small" type="success" effect="dark">精华</el-tag>
                  <el-tag v-if="p.status === 2 && p.resubmitAt" size="small" effect="dark" class="a-tag-resub" title="该帖曾被驳回，作者已修改并重新提交，等待再次审核">待重审</el-tag>
                  <el-tag v-else-if="p.status === 2" size="small" type="warning" effect="dark">待审核</el-tag>
                  <el-tag v-if="p.status === 1 && p.rejectReason" size="small" type="danger" effect="dark" :title="p.rejectReason">已驳回</el-tag>
                  <el-tag v-else-if="p.status === 1" size="small" type="info" effect="dark">已隐藏</el-tag>
                  <span class="a-target">{{ p.title }}</span>
                  <span class="a-board num">· {{ p.boardName }}</span>
                  <span class="a-board num">· {{ p.author }}</span>
                </div>
                <div class="a-meta num">
                  <!-- 待重审帖展示重提时间（而非首次发布时间） -->
                  {{ p.resubmitAt ? `${p.resubmitAt} · 重新提交` : p.createdAt }} · 💬 {{ p.replyCount }} · 👍 {{ p.likeCount }}
                </div>
                <div v-if="p.rejectReason" class="a-reason">
                  <b>驳回理由：</b>{{ p.rejectReason }}
                </div>
              </div>
              <div class="a-item-actions">
                <!-- 通用按钮（所有审核人可见） -->
                <el-button size="small" @click="openPreview(p)">查看内容</el-button>
                <!-- ADMIN 专属 -->
                <template v-if="userStore.isAdmin">
                  <el-button size="small" @click="togglePin(p)">{{ p.isTop ? '取消置顶' : '置顶' }}</el-button>
                  <el-button size="small" type="success" plain @click="toggleEssence(p)">{{ p.isEssence ? '取消加精' : '加精' }}</el-button>
                  <el-button v-if="p.status !== 2" size="small" type="info" plain @click="setPendingPost(p)">改为待审</el-button>
                </template>
                <!-- 审核操作：根据 status 与 canReview 决定 -->
                <el-button v-if="p.status === 2 && canReviewMap[p.id]" size="small" type="success" @click="approvePost(p)">允许发布</el-button>
                <el-button v-if="p.status === 2 && canReviewMap[p.id]" size="small" type="danger" plain @click="openReject(p)">驳回</el-button>
              </div>
            </div>
          </div>
          <el-pagination
            v-if="postList.total > postList.size"
            class="a-page"
            layout="prev, pager, next"
            :total="postList.total"
            :page-size="postList.size"
            :current-page="postList.current"
            @current-change="(pg) => loadPosts(pg)"
          />

          <!-- 帖子预览/审核弹窗（所有审核人可用）：显示标题/作者/板块/富文本内容 -->
          <el-dialog v-model="previewDialog.visible" :title="previewDialog.title || '查看帖子内容'" width="720px">
            <div v-if="previewDialog.loading" class="a-loading"><el-skeleton :rows="5" animated /></div>
            <div v-else-if="previewDialog.post" class="pv">
              <div class="pv-head">
                <h3 class="pv-title">{{ previewDialog.post.title }}</h3>
                <div class="pv-meta">
                  <span class="pv-author">{{ previewDialog.post.authorName }}</span>
                  <span
                    v-if="previewDialog.post.authorBadge"
                    class="pv-badge"
                    :class="`badge-${(previewDialog.post.authorBadge || '').toLowerCase()}`"
                    :title="previewDialog.post.authorBadge === 'MODERATOR' && (previewDialog.post.authorModeratorGameNames || []).length > 1 ? `负责游戏：${previewDialog.post.authorModeratorGameNames.join('、')}` : ''"
                  >{{ pvBadgeText }}</span>
                  <span v-if="previewDialog.post.authorLevel" class="pv-lv" :class="`lv-${previewDialog.post.authorLevel}`">{{ previewDialog.post.authorLevelTitle }}</span>
                  <span class="num pv-time">· {{ ((previewDialog.post.resubmitAt || previewDialog.post.createdAt) || '').replace('T', ' ').slice(0, 16) }}{{ previewDialog.post.resubmitAt ? ' · 重新提交' : '' }}</span>
                  <span class="num pv-board">· {{ previewDialog.post.boardName }}</span>
                </div>
              </div>
              <div v-if="previewDialog.post.cover" class="pv-section pv-section-cover">
                <div class="pv-section-label">🖼 封面图</div>
                <img :src="previewDialog.post.cover" alt="封面" class="pv-cover-img" />
              </div>
              <div class="pv-section pv-section-content">
                <div class="pv-section-label">📝 正文内容</div>
                <div class="pv-body" v-html="adminPreviewContent(previewDialog.post)"></div>
              </div>
              <div v-if="previewDialog.post.tags && previewDialog.post.tags.length" class="pv-tags">
                <el-tag v-for="t in previewDialog.post.tags" :key="t.id" size="small" type="info">{{ t.name }}</el-tag>
              </div>
              <div v-if="previewDialog.post.rejectReason" class="pv-reject">
                <b>驳回理由：</b>{{ previewDialog.post.rejectReason }}
              </div>
            </div>
            <template #footer>
              <el-button size="small" @click="previewDialog.visible = false">关闭</el-button>
              <el-button v-if="previewDialog.post && previewDialog.post.status === 2 && canReviewMap[previewDialog.post.id]" size="small" type="success" @click="approvePost(previewDialog.post); previewDialog.visible = false">允许发布</el-button>
              <el-button v-if="previewDialog.post && previewDialog.post.status === 2 && canReviewMap[previewDialog.post.id]" size="small" type="danger" plain @click="openReject(previewDialog.post); previewDialog.visible = false">驳回</el-button>
            </template>
          </el-dialog>

          <!-- 驳回输入弹窗：填理由 → 写后端 + 通知发帖人 -->
          <el-dialog v-model="rejectDialog.visible" title="驳回帖子" width="480px">
            <div v-if="rejectDialog.post" class="dlg-user">
              驳回：<b>{{ rejectDialog.post.title }}</b>
            </div>
            <el-input
              v-model="rejectDialog.reason"
              type="textarea"
              :rows="5"
              maxlength="500"
              show-word-limit
              placeholder="请输入驳回理由（必填，1-500 字），将作为站内通知发送给发帖人。"
            />
            <template #footer>
              <el-button size="small" @click="rejectDialog.visible = false">取消</el-button>
              <el-button size="small" type="danger" :loading="rejectDialog.loading" @click="confirmReject">确认驳回</el-button>
            </template>
          </el-dialog>

          <!-- 回帖审核已移除（功能冗余；如需回帖管理请走帖子详情页） -->
        </div>

        <!-- ================= 用户管理（仅 ADMIN） ================= -->
        <div v-else-if="activeTab === 'users' && userStore.isAdmin" class="a-section users-section">
          <div class="a-section-head">
            <div class="a-section-title">👥 用户管理</div>
            <div class="a-section-desc">注册用户一览：修改角色、给版主分配负责游戏（覆盖该游戏全部板块）、封禁/解封、编辑资料、重置密码或删除。共 {{ userList.total || 0 }} 位用户。</div>
          </div>
          <div class="a-filters">
            <el-input v-model="userKeyword" size="small" class="a-search" placeholder="搜索用户名 / 昵称" clearable @keyup.enter="loadUsers(1)" @clear="loadUsers(1)" />
            <!-- 9-07：按负责游戏筛版主（与 keyword 组合使用；非版主会被该过滤排除） -->
            <el-select v-model="userGameId" size="small" class="a-filter" placeholder="负责游戏（仅版主）" clearable @change="loadUsers(1)">
              <el-option v-for="g in gameListForFilter" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
            <el-button size="small" type="primary" @click="loadUsers(1)">搜索</el-button>
          </div>
          <div v-if="uLoading" class="a-loading"><el-skeleton :rows="5" animated /></div>
          <div v-else-if="!userList.records.length" class="a-empty">未找到用户</div>
          <div v-else class="a-list">
            <div v-for="u in userList.records" :key="u.id" class="a-item a-user-item">
              <el-avatar :size="40" :src="u.avatar" class="a-u-ava">{{ (u.nickname || u.username || '?').charAt(0) }}</el-avatar>
              <div class="a-item-main">
                <div class="a-item-top">
                  <b class="a-u-name">{{ u.nickname }}</b>
                  <span class="a-u-uname num">@{{ u.username }}</span>
                  <span class="a-id num">#{{ u.id }}</span>
                  <el-tag v-for="r in u.roles || []" :key="r" size="small" :type="roleTagType(r)" class="u-role">{{ roleText(r) }}</el-tag>
                  <span class="a-time num">{{ u.createdAt }}</span>
                </div>
                <div class="a-meta">
                  <span :class="u.status === 1 ? 'st-hidden' : 'st-visible'">
                    {{ u.status === 1 ? '已封禁' : '正常' }}
                  </span>
                  <!-- 9-07：版主卡片显示「负责游戏」标签（来自 moderatorAssignments.gameName） -->
                  <span
                    v-if="(u.roles || []).includes('MODERATOR') && (u.moderatorAssignments || []).length"
                    class="a-u-game"
                  >
                    · 负责游戏：
                    <el-tag
                      v-for="a in u.moderatorAssignments"
                      :key="`${a.gameId}-${a.boardId}`"
                      size="small"
                      effect="plain"
                      type="warning"
                      class="a-u-game-tag"
                    >{{ a.gameName || ('游戏#' + a.gameId) }}</el-tag>
                  </span>
                </div>
              </div>
              <div class="a-item-actions">
                <el-button size="small" @click="openRoleDialog(u)">改角色</el-button>
                <el-button size="small" :type="u.status === 1 ? 'success' : 'warning'" plain :disabled="u.id === userStore.userId" @click="toggleUserStatus(u)">
                  {{ u.status === 1 ? '解封' : '封禁' }}
                </el-button>
                <el-button size="small" :disabled="u.id === userStore.userId" @click="openPwdDialog(u)">改密</el-button>
                <el-button size="small" type="danger" plain :disabled="u.id === userStore.userId" @click="removeUser(u)">删除</el-button>
              </div>
            </div>
          </div>
          <el-pagination
            v-if="userList.total > userList.size"
            class="a-page"
            layout="prev, pager, next"
            :total="userList.total"
            :page-size="userList.size"
            :current-page="userList.current"
            @current-change="(pg) => loadUsers(pg)"
          />

          <!-- 改角色弹窗（兼任版主游戏选择；取消独立的「分配游戏」入口） -->
          <el-dialog v-model="roleDialog.visible" title="修改角色" width="500px">
            <div v-if="roleDialog.user" class="dlg-user">
              用户：<b>{{ roleDialog.user.nickname }}</b>
              <span class="num">@{{ roleDialog.user.username }}</span>
            </div>
            <el-alert
              type="info"
              :closable="false"
              class="dlg-warn"
              title="提示"
              :description="`用户同一时间只能拥有一种角色；且一名版主只能担任一个游戏的版主（负责即覆盖该游戏全部板块，同一游戏最多可配 5 位版主）。从「版主」改为其他角色时，已分配的游戏将自动清空。`"
            />
            <el-radio-group v-model="roleDialog.selected" class="dlg-roles">
              <el-radio v-for="o in ROLE_OPTIONS" :key="o.code" :value="o.code" border>{{ o.label }}</el-radio>
            </el-radio-group>
            <!-- 仅当目标角色是版主时显示游戏单选 -->
            <template v-if="roleDialog.selected === 'MODERATOR'">
              <div class="dlg-roles-title">
                <span class="rt">负责游戏</span>
                <span class="a-tip num">单选，只能选 1 个</span>
              </div>
              <div v-loading="roleDialog.loading" class="mb-list role-games">
                <label
                  v-for="g in roleDialog.games"
                  :key="g.id"
                  class="mb-game-item"
                  :class="{ selected: roleDialog.selectedGame === g.id }"
                  @click="toggleRoleGame(g.id)"
                >
                  <span class="mb-radio"><i v-if="roleDialog.selectedGame === g.id" class="mb-radio-dot"></i></span>
                  <span class="mb-game-name">{{ g.name }}</span>
                  <span v-if="g.id === 1" class="mb-tip">兜底</span>
                </label>
              </div>
            </template>
            <template #footer>
              <el-button size="small" @click="roleDialog.visible = false">取消</el-button>
              <el-button size="small" type="primary" @click="saveRoles">保存</el-button>
            </template>
          </el-dialog>

          <!-- 重置密码弹窗 -->
          <el-dialog v-model="pwdDialog.visible" title="重置密码" width="460px">
            <div v-if="pwdDialog.user" class="dlg-user">
              用户：<b>{{ pwdDialog.user.nickname }}</b>
              <span class="num">@{{ pwdDialog.user.username }}</span>
            </div>
            <el-alert
              type="info"
              :closable="false"
              class="dlg-warn"
              title="提示"
              description="请输入新密码（≥6 位），不允许留空。提交后请把新密码私下告知用户，并提醒尽快登录修改。"
            />
            <el-input
              v-model="pwdDialog.newPassword"
              type="password"
              size="small"
              placeholder="输入新密码（≥6 位）"
              show-password
              class="dlg-pwd"
            />
            <template #footer>
              <el-button size="small" @click="pwdDialog.visible = false">取消</el-button>
              <el-button size="small" type="primary" :loading="pwdDialog.saving" @click="savePassword">重置</el-button>
            </template>
          </el-dialog>
        </div>

        <!-- ================= 游戏管理（仅 ADMIN） ================= -->
        <div v-else-if="activeTab === 'games' && userStore.isAdmin" class="a-section games-section">
          <div class="a-section-head">
            <div class="a-section-title">🎮 游戏管理</div>
            <div class="a-section-desc">维护前台游戏库：新建 / 编辑游戏信息、禁用隐藏或删除。当前共 {{ gameList.length }} 个游戏（禁用即在游戏库隐藏）。</div>
          </div>
          <div class="a-filters">
            <el-button size="small" type="primary" @click="openGameForm(null)">新建游戏</el-button>
            <el-button size="small" plain @click="loadGames">刷新</el-button>
            <span class="a-tip num">共 {{ gameList.length }} 个游戏</span>
          </div>
          <div v-if="gLoading" class="a-loading"><el-skeleton :rows="6" animated /></div>
          <div v-else-if="!gameList.length" class="a-empty">暂无游戏</div>
          <div v-else class="a-list">
            <div v-for="g in gameList" :key="g.id" class="a-item">
              <img v-if="g.cover" :src="g.cover" class="a-g-cover" alt="cover" />
              <span v-else class="a-g-cover a-g-noimg">🎮</span>
              <div class="a-item-main">
                <div class="a-item-top">
                  <b class="a-g-name">{{ g.name }}</b>
                  <el-tag v-if="g.status === 1" type="danger" size="small" effect="dark">已禁用</el-tag>
                  <el-tag v-else type="success" size="small" effect="dark">启用</el-tag>
                  <span class="a-id num">#{{ g.id }}</span>
                  <span class="a-time num">排序 {{ g.sort }}</span>
                </div>
                <div class="a-meta">
                  {{ g.platform || '—' }} · {{ g.genre || '未分类' }} · 💬 {{ g.postCount || 0 }} 帖
                </div>
              </div>
              <div class="a-item-actions">
                <el-button size="small" @click="openGameForm(g)">编辑</el-button>
                <el-button size="small" :type="g.status === 1 ? 'success' : 'warning'" plain @click="toggleGame(g)">
                  {{ g.status === 1 ? '启用' : '禁用' }}
                </el-button>
                <el-popconfirm :title="`确认删除游戏「${g.name}」？`" width="240" @confirm="removeGame(g)">
                  <template #reference>
                    <el-button size="small" type="danger" plain>删除</el-button>
                  </template>
                </el-popconfirm>
              </div>
            </div>
          </div>

          <!-- 新建/编辑游戏弹窗 -->
          <el-dialog v-model="gameForm.visible" :title="gameForm.id ? '编辑游戏' : '新建游戏'" width="520px">
            <el-form label-width="70px" size="small">
              <el-form-item label="名称" required>
                <el-input v-model="gameForm.name" maxlength="60" show-word-limit placeholder="游戏名称（必填）" />
              </el-form-item>
              <el-form-item label="封面">
                <el-input v-model="gameForm.cover" placeholder="封面图 URL（选填）" />
              </el-form-item>
              <el-form-item label="平台">
                <el-input v-model="gameForm.platform" maxlength="30" placeholder="如 PC / 主机 / 移动 / 多平台" />
              </el-form-item>
              <el-form-item label="类型">
                <el-input v-model="gameForm.genre" maxlength="30" placeholder="如 角色扮演 / 射击 / 策略" />
              </el-form-item>
              <el-form-item label="开发商">
                <el-input v-model="gameForm.developer" maxlength="60" placeholder="开发商（选填）" />
              </el-form-item>
              <el-form-item label="发行商">
                <el-input v-model="gameForm.publisher" maxlength="60" placeholder="发行商（选填）" />
              </el-form-item>
              <el-form-item label="发行日">
                <el-input v-model="gameForm.releaseDate" maxlength="20" placeholder="如 2024-08-20（选填）" />
              </el-form-item>
              <el-form-item label="排序">
                <el-input-number v-model="gameForm.sort" :min="0" :max="9999" size="small" />
                <span class="a-tip num" style="margin-left: 8px">数字越小越靠前</span>
              </el-form-item>
              <el-form-item label="简介">
                <el-input v-model="gameForm.description" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="游戏简介（选填）" />
              </el-form-item>
            </el-form>
            <template #footer>
              <el-button size="small" @click="gameForm.visible = false">取消</el-button>
              <el-button size="small" type="primary" @click="saveGame">保存</el-button>
            </template>
          </el-dialog>
        </div>

        <!-- v1.2 起：精选改为系统按综合评分自动选（人工加精走 post.is_essence），精选管理 tab 已移除 -->

        <!-- ================= 公告管理（仅 ADMIN） ================= -->
        <div v-else-if="activeTab === 'announcements' && userStore.isAdmin" class="a-section announcements-section">
          <div class="a-section-head">
            <div class="a-section-title">📢 公告管理</div>
            <div class="a-section-desc">发布社区公告：置顶项排在前、首页弹窗优先推送，同状态内按发布时间倒序。</div>
          </div>
          <div class="a-filters">
            <el-button size="small" type="primary" @click="openAnnouncementForm(null)">发布新公告</el-button>
            <el-button size="small" plain @click="loadAnnouncements()">刷新</el-button>
          </div>
          <div v-if="anLoading" class="a-loading"><el-skeleton :rows="5" animated /></div>
          <div v-else-if="!announcementList.records.length" class="a-empty">暂无公告</div>
          <div v-else class="a-list">
            <div v-for="a in announcementList.records" :key="a.id" class="a-item a-an-item">
              <div class="a-item-main">
                <div class="a-item-top">
                  <b class="a-an-title">{{ a.title }}</b>
                  <el-tag v-if="a.isTop" type="warning" size="small" effect="dark">📌 置顶</el-tag>
                  <el-tag :type="a.status === 0 ? 'success' : 'info'" size="small" effect="plain">{{ a.status === 0 ? '展示中' : '已隐藏' }}</el-tag>
                  <span class="a-id num">{{ a.creatorName }}</span>
                  <span class="a-time num">{{ a.createdAt }}</span>
                </div>
                <div class="a-meta a-an-content">{{ a.content }}</div>
              </div>
              <div class="a-item-actions">
                <el-switch
                  v-model="a.isTop"
                  :loading="pinLoadingId === a.id"
                  inline-prompt
                  active-text="📌"
                  inactive-text=""
                  @change="toggleAnnouncementPin(a)"
                />
                <el-button size="small" @click="openAnnouncementForm(a)">编辑</el-button>
                <el-popconfirm :title="`确认删除公告「${a.title}」？`" width="240" @confirm="removeAnnouncement(a)">
                  <template #reference>
                    <el-button size="small" type="danger" plain>删除</el-button>
                  </template>
                </el-popconfirm>
              </div>
            </div>
          </div>
          <el-pagination
            v-if="announcementList.total > announcementList.size"
            class="a-page"
            layout="prev, pager, next"
            :total="announcementList.total"
            :page-size="announcementList.size"
            :current-page="announcementList.current"
            @current-change="(pg) => loadAnnouncements(pg)"
          />

          <!-- 新建/编辑公告弹窗 —— v1.2 起不再有「排序」字段，「📌 置顶」开关可创建时直接置顶 -->
          <el-dialog v-model="announcementForm.visible" :title="announcementForm.id ? '编辑公告' : '发布新公告'" width="560px">
            <el-form label-width="70px" size="small">
              <el-form-item label="标题" required>
                <el-input v-model="announcementForm.title" maxlength="100" show-word-limit placeholder="公告标题" />
              </el-form-item>
              <el-form-item label="内容" required>
                <el-input v-model="announcementForm.content" type="textarea" :rows="5" maxlength="5000" show-word-limit placeholder="公告正文（≤5000 字）" />
              </el-form-item>
              <el-form-item label="状态">
                <el-radio-group v-model="announcementForm.status">
                  <el-radio :value="0">展示</el-radio>
                  <el-radio :value="1">隐藏</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="置顶">
                <el-switch
                  v-model="announcementForm.isTop"
                  inline-prompt
                  active-text="📌 是"
                  inactive-text="否"
                  style="--el-switch-on-color: #ff8466"
                />
                <span class="a-tip num" style="margin-left: 8px">置顶后会排在列表最前面</span>
              </el-form-item>
            </el-form>
            <template #footer>
              <el-button size="small" @click="announcementForm.visible = false">取消</el-button>
              <el-button size="small" type="primary" @click="saveAnnouncement">保存</el-button>
            </template>
          </el-dialog>
        </div>
      </template>
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import { useUserStore } from '@/store'
import { renderRichText } from '@/utils/richtext'
import {
  listReports,
  handleReport,
  listModerationPosts,
  adminPinPost,
  adminEssencePost,
  adminApprovePost,
  adminSetPostPending,
  adminPostDetail,
  adminRejectPost,
  adminCanReviewPost,
  listAdminUsers,
  updateUserRoles,
  getModeratorBoards,
  setModeratorBoards,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
  listAdminAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  pinAnnouncement,
  getBoards,
  getGames,
  getGameDetail,
  listAdminGames,
  createGame,
  updateGame,
  deleteGame,
  toggleGameStatus as apiToggleGameStatus
} from '@/api/community'

const userStore = useUserStore()
const router = useRouter()
const ROLE_OPTIONS = [
  { code: 'USER', label: '普通用户' },
  { code: 'MODERATOR', label: '版主' },
  { code: 'ADMIN', label: '管理员' }
]
const roleText = (code) => ROLE_OPTIONS.find((o) => o.code === code)?.label || code
const roleTagType = (code) => (code === 'ADMIN' ? 'danger' : code === 'MODERATOR' ? 'warning' : 'info')

const activeTab = ref('reports')

// 板块选项（父 + 子摊平），用于帖子筛选与版主板块分配
const allBoardOptions = ref([])
const boardData = ref({ parents: [], childrenOf: () => [] })
function flattenBoards() {
  const opts = []
  for (const p of boardData.value.parents) {
    opts.push({ id: p.id, name: p.name })
    for (const c of boardData.value.childrenOf(p.id)) opts.push({ id: c.id, name: `${p.name} / ${c.name}` })
  }
  return opts
}

// ---------------- 举报队列 ----------------
const reportTab = ref('0')
const rLoading = ref(false)
const reportList = ref({ records: [], total: 0, pages: 0, current: 1, size: 20 })
const notes = ref({})
async function loadReports(tab, current = 1) {
  if (!userStore.canModerate) return
  const status = tab === 'all' ? null : Number(tab)
  rLoading.value = true
  try {
    reportList.value = await listReports({ status, current, size: 20 })
  } finally {
    rLoading.value = false
  }
}
async function submitReportReq(id, status) {
  try {
    await handleReport(id, { status, handleNote: notes.value[id] || '' })
    ElMessage.success(status === 1 ? '已标记为违规并处理' : '已驳回该举报')
    await loadReports(reportTab.value, reportList.value.current)
  } catch (e) {
    // 业务失败由 request 拦截器统一 toast
  }
}

/**
 * 9-07：举报队列「查看原文」入口
 *   type=1 帖子 → /post/{postId}
 *   type=2 回复 → /post/{postId}?replyId={replyId}（高亮该楼 + 滚动到位）
 *   type=3 用户 → /user/{targetId}
 */
function openTarget(r) {
  if (!r) return
  if (r.targetType === 1 && r.postId) {
    router.push(`/post/${r.postId}`)
  } else if (r.targetType === 2 && r.postId) {
    const url = r.replyId ? `/post/${r.postId}?replyId=${r.replyId}` : `/post/${r.postId}`
    router.push(url)
  } else if (r.targetType === 3 && r.targetId) {
    router.push(`/user/${r.targetId}`)
  } else {
    ElMessage.warning('该举报关联的资源已不可访问')
  }
}

// ---------------- 帖子审核 ----------------
const pLoading = ref(false)
const postList = ref({ records: [], total: 0, pages: 0, current: 1, size: 20 })
const postFilter = reactive({ boardId: null, status: 2, order: 'desc', days: null }) // 默认进入「待审核」视图，按提交时间最新优先
// 帖子 → 当前用户能否审（控制按钮可见性 + 弹窗内联按钮）
const canReviewMap = reactive({})
async function loadPosts(current = 1) {
  if (!userStore.canModerate) return
  pLoading.value = true
  try {
    postList.value = await listModerationPosts({
      boardId: postFilter.boardId,
      status: postFilter.status,
      order: postFilter.order,
      days: postFilter.days,
      current,
      size: 20
    })
    // 对当前列表里所有 status=2 的帖子，并行查一次 canReview 控制按钮
    const pendingIds = postList.value.records.filter((p) => p.status === 2).map((p) => p.id)
    const results = await Promise.all(pendingIds.map((id) => adminCanReviewPost(id).catch(() => ({ canReview: false }))))
    // 重置后写入
    Object.keys(canReviewMap).forEach((k) => delete canReviewMap[k])
    pendingIds.forEach((id, idx) => {
      canReviewMap[id] = !!results[idx]?.canReview
    })
  } finally {
    pLoading.value = false
  }
}
async function togglePin(p) {
  await adminPinPost(p.id)
  ElMessage.success(p.isTop ? '已取消置顶' : '已置顶')
  await loadPosts(postList.value.current)
}
async function toggleEssence(p) {
  await adminEssencePost(p.id)
  ElMessage.success(p.isEssence ? '已取消加精' : '已加精')
  await loadPosts(postList.value.current)
}
const postStatusText = (p) => (p.status === 1 ? '隐藏' : p.status === 2 ? '待审核' : '可见')
const postStatusClass = (p) => (p.status === 1 ? 'st-hidden' : p.status === 2 ? 'st-pending' : 'st-visible')

// 通过发布 / 设为待审核（仅 ADMIN）
async function approvePost(p) {
  try {
    await adminApprovePost(p.id)
    ElMessage.success('已通过发布')
    await loadPosts(postList.value.current)
  } catch (e) {}
}
async function setPendingPost(p) {
  try {
    await adminSetPostPending(p.id)
    ElMessage.success('已设为待审核（前台不可见）')
    await loadPosts(postList.value.current)
  } catch (e) {}
}

// 帖子预览（ADMIN / MODERATOR 通用）
const previewDialog = reactive({ visible: false, loading: false, post: null })
// 1.2 起：预览弹窗作者徽章拼上负责游戏名（与 PostDetail 一致）
const pvBadgeText = computed(() => {
  const p = previewDialog.post
  if (!p || !p.authorBadge) return ''
  const base = { ADMIN: '管理员', MODERATOR: '版主', SUB_MODERATOR: '子板主' }[p.authorBadge] || ''
  if (p.authorBadge === 'MODERATOR' && Array.isArray(p.authorModeratorGameNames) && p.authorModeratorGameNames.length > 0) {
    const extra = p.authorModeratorGameNames.length - 1
    return `${base} · ${p.authorModeratorGameNames[0]}${extra > 0 ? ` (+${extra})` : ''}`
  }
  return base
})

/**
 * 审核预览专用：标准 markdown 渲染 + 把"非标准"的 [图](url) 链接强制渲染成 <img>。
 * 缘由：用户/历史数据常用 [图](url) 表示图片（缺感叹号），renderRichText 默认当普通链接，
 *      审核人无法判断图片违规。后处理仅在审核预览生效，不影响前台 PostDetail。
 */
function adminPreviewContent(p) {
  if (!p) return ''
  const html = renderRichText(p.content || '')
  return html.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>\s*图\s*<\/a>/g,
    '<img src="$1" alt="图" class="pv-inline-img" />')
}
async function openPreview(p) {
  previewDialog.post = null
  previewDialog.loading = true
  previewDialog.visible = true
  try {
    const d = await adminPostDetail(p.id)
    previewDialog.post = d || p
  } catch (e) {
    ElMessage.error('获取帖子详情失败')
    previewDialog.visible = false
  } finally {
    previewDialog.loading = false
  }
}

// 驳回输入弹窗
const rejectDialog = reactive({ visible: false, loading: false, post: null, reason: '' })
function openReject(p) {
  rejectDialog.post = p
  rejectDialog.reason = ''
  rejectDialog.visible = true
}
async function confirmReject() {
  if (!rejectDialog.post) return
  const reason = (rejectDialog.reason || '').trim()
  if (!reason) return ElMessage.warning('请填写驳回理由')
  if (reason.length > 500) return ElMessage.warning('理由不能超过 500 字')
  rejectDialog.loading = true
  try {
    await adminRejectPost(rejectDialog.post.id, reason)
    ElMessage.success('已驳回，帖子已隐藏并通知发帖人')
    rejectDialog.visible = false
    await loadPosts(postList.value.current)
  } catch (e) {
    // 拦截器会提示
  } finally {
    rejectDialog.loading = false
  }
}

// 回帖审核已移除（功能冗余；如需回帖管理请走帖子详情页）

// ---------------- 用户管理（仅 ADMIN） ----------------
const uLoading = ref(false)
const userKeyword = ref('')
const userGameId = ref(null) // 9-07：按负责游戏筛版主
const gameListForFilter = ref([]) // 9-07：用户管理下拉数据源
const userList = ref({ records: [], total: 0, pages: 0, current: 1, size: 20 })
async function loadUsers(current = 1) {
  if (!userStore.isAdmin) return
  uLoading.value = true
  try {
    userList.value = await listAdminUsers({
      keyword: userKeyword.value,
      gameId: userGameId.value,
      current,
      size: 20
    })
  } finally {
    uLoading.value = false
  }
}

const roleDialog = reactive({
  visible: false,
  user: null,
  selected: 'USER',
  // 仅在 selected === 'MODERATOR' 时使用：单选一个游戏
  games: [],
  selectedGame: null,
  loading: false
})
function toggleRoleGame(gameId) {
  roleDialog.selectedGame = roleDialog.selectedGame === gameId ? null : gameId
}
async function openRoleDialog(row) {
  roleDialog.user = row
  roleDialog.selected = (row.roles && row.roles.length > 0) ? row.roles[0] : 'USER'
  roleDialog.games = []
  roleDialog.selectedGame = null
  roleDialog.loading = false
  roleDialog.visible = true
  // 预先加载游戏列表与已有负责游戏，避免重复请求
  try {
    roleDialog.loading = true
    const games = await loadModeratorGames()
    const assignments = (await getModeratorBoards(row.id)) || []
    let picked = null
    assignments.forEach((a) => {
      if (a && a.gameId != null) {
        if (picked === null) picked = a.gameId
        // 已分配但不在当前游戏列表里（如历史项）补回，保证可见可取消
        if (!games.some((g) => g.id === a.gameId)) {
          games.push({ id: a.gameId, name: a.gameName || `游戏#${a.gameId}` })
        }
      }
    })
    roleDialog.games = games
    roleDialog.selectedGame = picked
  } catch (e) {
    roleDialog.games = roleDialog.games || []
  } finally {
    roleDialog.loading = false
  }
}
async function saveRoles() {
  if (!roleDialog.user || !roleDialog.selected) return
  // 版主必须选择（且只能选）一个负责游戏
  if (roleDialog.selected === 'MODERATOR' && roleDialog.selectedGame == null) {
    ElMessage.warning('请选择 1 个负责游戏，否则无法成为版主')
    return
  }
  const pickedGames = roleDialog.selected === 'MODERATOR' ? [{ gameId: roleDialog.selectedGame }] : []
  try {
    // 先更新角色（非版主会在后端自动清空游戏），再单独提交版主游戏（仅在版主角色时）
    await updateUserRoles(roleDialog.user.id, [roleDialog.selected])
    if (roleDialog.selected === 'MODERATOR') {
      await setModeratorBoards(roleDialog.user.id, pickedGames)
    }
    ElMessage.success(`角色已更新为「${roleText(roleDialog.selected)}」`)
    roleDialog.visible = false
    await loadUsers(userList.value.current)
  } catch (e) {}
}

// 加载可选游戏列表（版主按游戏授权，gameId=1 的「其他游戏」永远置顶，保证冷门游戏也有版主）
async function loadModeratorGames() {
  const games = []
  try {
    const other = await getGameDetail(1)
    if (other) games.push(other)
  } catch (e) {}
  try {
    const got = await getGames({ current: 1, size: 200 })
    ;(got.records || []).forEach((g) => {
      if (g.id !== 1) games.push(g)
    })
  } catch (e) {}
  return games
}

// 封禁 / 解封（不能操作自己）
async function toggleUserStatus(row) {
  try {
    await updateUserStatus(row.id, row.status === 1 ? 0 : 1)
    ElMessage.success(row.status === 1 ? '已解封该用户' : '已封禁该用户')
    await loadUsers(userList.value.current)
  } catch (e) {}
}

// 重置密码（必须填）
const pwdDialog = reactive({ visible: false, user: null, newPassword: '', saving: false })
function openPwdDialog(row) {
  pwdDialog.user = row
  pwdDialog.newPassword = ''
  pwdDialog.visible = true
}
async function savePassword() {
  if (!pwdDialog.user) return
  const pwd = (pwdDialog.newPassword || '').trim()
  if (!pwd) {
    ElMessage.warning('请输入新密码，不允许留空')
    return
  }
  if (pwd.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  pwdDialog.saving = true
  try {
    await resetUserPassword(pwdDialog.user.id, pwd)
    ElMessage.success(`密码已重置为「${pwd}」，请妥善保存并私下告知用户`)
    pwdDialog.visible = false
  } catch (e) {
    // 拦截器已提示
  } finally {
    pwdDialog.saving = false
  }
}

// 删除用户（不能操作自己）
async function removeUser(row) {
  try {
    await deleteUser(row.id)
    ElMessage.success('用户已删除')
    await loadUsers(userList.value.current)
  } catch (e) {}
}

// 公开板块选项（帖子审核筛选用），1.2 起板块固定六分类
async function refreshBoardOptions() {
  try {
    const res = await getBoards()
    boardData.value = res
    allBoardOptions.value = flattenBoards()
  } catch (e) {}
}

// ---------------- 公告管理（仅 ADMIN） ----------------
const anLoading = ref(false)
const announcementList = ref({ records: [], total: 0, pages: 0, current: 1, size: 20 })
async function loadAnnouncements(current = 1) {
  if (!userStore.isAdmin) return
  anLoading.value = true
  try {
    announcementList.value = await listAdminAnnouncements({ current, size: 20 })
  } catch (e) {
  } finally {
    anLoading.value = false
  }
}

const announcementForm = reactive({
  visible: false,
  id: null,
  title: '',
  content: '',
  // v1.2 起：创建/编辑不再需要 sort 字段；置顶状态由本字段控制并随公告一起保存
  status: 0,
  isTop: false
})
// pin 操作 loading 标记（用于 el-switch 的 loading 态），按 id 区分
const pinLoadingId = ref(null)
function openAnnouncementForm(row) {
  if (row) {
    announcementForm.id = row.id
    announcementForm.title = row.title
    announcementForm.content = row.content
    announcementForm.status = row.status == null ? 0 : row.status
    announcementForm.isTop = !!row.isTop
  } else {
    announcementForm.id = null
    announcementForm.title = ''
    announcementForm.content = ''
    announcementForm.status = 0
    announcementForm.isTop = false
  }
  announcementForm.visible = true
}
async function toggleAnnouncementPin(row) {
  // 用户点开关时 row.isTop 已经被 el-switch 改了，先保存期望状态，再调用后端
  const desired = !!row.isTop
  pinLoadingId.value = row.id
  try {
    await pinAnnouncement(row.id, desired)
    ElMessage.success(desired ? '已置顶' : '已取消置顶')
    // 置顶/取消置顶会改变排序，刷新整张列表让顺序立刻生效
    await loadAnnouncements(announcementList.value.current)
  } catch (e) {
    // 失败回滚开关
    row.isTop = !desired
  } finally {
    pinLoadingId.value = null
  }
}
async function saveAnnouncement() {
  if (!announcementForm.title.trim()) {
    ElMessage.warning('请填写公告标题')
    return
  }
  if (!announcementForm.content.trim()) {
    ElMessage.warning('请填写公告内容')
    return
  }
  const payload = {
    title: announcementForm.title.trim(),
    content: announcementForm.content.trim(),
    status: announcementForm.status == null ? 0 : announcementForm.status
  }
  try {
    let id = announcementForm.id
    if (id) {
      // 编辑：保留原本的置顶状态，再依据用户当前选择切换
      const oldRecord = announcementList.value.records.find((r) => r.id === id)
      const oldIsTop = !!(oldRecord && oldRecord.isTop)
      await updateAnnouncement(id, payload)
      if (oldIsTop !== !!announcementForm.isTop) {
        await pinAnnouncement(id, !!announcementForm.isTop)
      }
      ElMessage.success('公告已更新')
    } else {
      // 创建：先建公告，再用返回的 id 应用置顶
      const created = await createAnnouncement(payload)
      id = created && created.id
      if (id && announcementForm.isTop) {
        await pinAnnouncement(id, true)
      }
      ElMessage.success('公告已发布')
    }
    announcementForm.visible = false
    await loadAnnouncements(announcementList.value.current)
  } catch (e) {}
}
async function removeAnnouncement(row) {
  try {
    await deleteAnnouncement(row.id)
    ElMessage.success('公告已删除')
    await loadAnnouncements(announcementList.value.current)
  } catch (e) {}
}

// ---------------- 游戏管理（仅 ADMIN） ----------------
const gLoading = ref(false)
const gameList = ref([])
async function loadGames() {
  if (!userStore.isAdmin) return
  gLoading.value = true
  try {
    gameList.value = await listAdminGames()
  } catch (e) {
  } finally {
    gLoading.value = false
  }
}

const gameForm = reactive({
  visible: false,
  id: null,
  name: '',
  cover: '',
  platform: '',
  genre: '',
  developer: '',
  publisher: '',
  releaseDate: '',
  sort: 0,
  description: ''
})
function openGameForm(row) {
  if (row) {
    gameForm.id = row.id
    gameForm.name = row.name || ''
    gameForm.cover = row.cover || ''
    gameForm.platform = row.platform || ''
    gameForm.genre = row.genre || ''
    gameForm.developer = row.developer || ''
    gameForm.publisher = row.publisher || ''
    gameForm.releaseDate = row.releaseDate || ''
    gameForm.sort = row.sort || 0
    gameForm.description = row.description || ''
  } else {
    gameForm.id = null
    gameForm.name = ''
    gameForm.cover = ''
    gameForm.platform = ''
    gameForm.genre = ''
    gameForm.developer = ''
    gameForm.publisher = ''
    gameForm.releaseDate = ''
    gameForm.sort = 0
    gameForm.description = ''
  }
  gameForm.visible = true
}
async function saveGame() {
  if (!gameForm.name.trim()) {
    ElMessage.warning('请填写游戏名称')
    return
  }
  const payload = {
    name: gameForm.name.trim(),
    cover: gameForm.cover || null,
    platform: gameForm.platform || null,
    genre: gameForm.genre || null,
    developer: gameForm.developer || null,
    publisher: gameForm.publisher || null,
    releaseDate: gameForm.releaseDate || null,
    sort: gameForm.sort || 0,
    description: gameForm.description || null
  }
  try {
    if (gameForm.id) await updateGame(gameForm.id, payload)
    else await createGame(payload)
    ElMessage.success(gameForm.id ? '游戏已更新' : '游戏已创建')
    gameForm.visible = false
    await loadGames()
  } catch (e) {}
}
async function toggleGame(row) {
  try {
    await apiToggleGameStatus(row.id)
    ElMessage.success(row.status === 1 ? '游戏已启用' : '游戏已禁用')
    await loadGames()
  } catch (e) {}
}
async function removeGame(row) {
  try {
    await deleteGame(row.id)
    ElMessage.success('游戏已删除')
    await loadGames()
  } catch (e) {}
}

// ---------------- 切换 tab ----------------
function onTabChange() {
  if (activeTab.value === 'reports') loadReports(reportTab.value)
  else if (activeTab.value === 'posts') loadPosts(1)
  else if (activeTab.value === 'users') loadUsers(1)
  else if (activeTab.value === 'games') loadGames()
  else if (activeTab.value === 'announcements') loadAnnouncements(1)
}

onMounted(async () => {
  const res = await getBoards()
  boardData.value = res
  allBoardOptions.value = flattenBoards()
  if (userStore.canModerate) loadReports(reportTab.value)
  // 9-07：用户管理下拉需要的游戏列表（含禁用）—— 仅 ADMIN 有意义，且不阻塞首屏
  if (userStore.isAdmin) {
    try {
      const games = await listAdminGames()
      gameListForFilter.value = games
    } catch (e) { /* 静默失败：下拉为空不影响主功能 */ }
  }
})
</script>

<style scoped>
.admin {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
}
.a-head {
  margin-bottom: 16px;
}
.a-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 800;
  color: var(--t1);
}
.a-sub {
  margin: 0;
  font-size: 13px;
  color: var(--t3);
  line-height: 1.6;
}
.a-tabs {
  margin-bottom: 4px;
}
.a-subtabs {
  margin-bottom: 10px;
}
/* 区块视觉差异：举报队列（暖橙红）+ 帖子审核（中性紫蓝），跟其他 tab 拉开视觉 */
.a-section {
  border-radius: 12px;
  padding: 16px 18px 8px 18px;
  margin-top: 8px;
}
.a-section-head {
  margin-bottom: 14px;
}
.a-section-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 4px;
}
.a-section-desc {
  font-size: 12px;
  color: var(--t3);
}
.reports-section {
  background: linear-gradient(180deg, rgba(255, 132, 102, 0.07), rgba(255, 132, 102, 0.02));
  border: 1px solid rgba(255, 132, 102, 0.18);
}
.reports-section .a-section-title { color: #ff8466; }
.posts-section {
  background: linear-gradient(180deg, rgba(110, 142, 255, 0.06), rgba(110, 142, 255, 0.02));
  border: 1px solid rgba(110, 142, 255, 0.18);
}
.posts-section .a-section-title { color: #6e8eff; }
.a-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.a-filter {
  width: 150px;
}
/* 状态筛选按钮组：自适应宽度、强制单行（此前误用 150px 的 a-filter 被挤成两行堆叠） */
.a-filter-seg {
  flex: none;
  white-space: nowrap;
}
/* 时间窗筛选（仅对「可见」视图生效）：紧凑宽度，跟其它控件风格一致 */
.a-filter-days {
  width: 150px;
}
/* 待重审角标：紫色系，与普通「待审核」(橙)、「已驳回」(红) 区分 */
.a-tag-resub {
  background: #7f5af0;
  border-color: #7f5af0;
  color: #fff;
  cursor: help;
}
.a-search {
  width: 220px;
}
.a-empty,
.a-loading {
  padding: 30px 0;
}
.a-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.a-item {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.a-item-main {
  flex: 1;
  min-width: 0;
}
.a-item-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.a-tag {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--brand-soft, rgba(124, 92, 255, 0.16));
  color: var(--brand, #7c5cff);
}
.a-tag.t2 { background: rgba(56, 178, 172, 0.16); color: #4fd1c5; }
.a-tag.t3 { background: rgba(245, 158, 11, 0.16); color: #f6c453; }
.a-target {
  font-size: 13.5px;
  color: var(--t1);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.a-board { color: var(--t3); font-size: 12px; }
.a-id { color: var(--t3); font-size: 12px; }
.a-time { margin-left: auto; color: var(--t3); font-size: 12px; }
.a-meta { font-size: 12.5px; color: var(--t3); }
.a-reason {
  font-size: 13.5px;
  color: var(--t2);
  line-height: 1.6;
}
.a-handled {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--t3);
}
.a-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.a-note {
  width: 160px;
}
.a-page {
  margin-top: 14px;
  justify-content: center;
}
.st-visible { color: #4fd1c5; font-weight: 700; }
.st-hidden { color: #f87171; font-weight: 700; }
.st-pending { color: #f6c453; font-weight: 700; }
.a-tip { font-size: 12px; color: var(--t3); }
.dlg-pwd { width: 100%; margin-top: 10px; }
.pv-head { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px dashed #d1d5db; }
/* el-dialog 默认浅色背景，深色主题的 --t1/--t2 是浅白文字，会看不清；显式深色 */
.pv-title { margin: 0 0 8px; font-size: 19px; font-weight: 800; color: #111827; line-height: 1.4; }
.pv-meta { font-size: 12.5px; color: #6b7280; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pv-author { font-weight: 700; color: #1f2937; }
.pv-time, .pv-board { color: #6b7280; }
.pv-badge { font-size: 10.5px; padding: 1px 6px; border-radius: 6px; border: 1px solid; line-height: 16px; height: 18px; }
.pv-badge.badge-admin { color: #b91c1c; border-color: rgba(185,28,28,0.5); background: rgba(185,28,28,0.08); }
.pv-badge.badge-mod { color: #b45309; border-color: rgba(180,83,9,0.5); background: rgba(180,83,9,0.1); }
.pv-badge.badge-sub { color: #1d4ed8; border-color: rgba(29,78,216,0.5); background: rgba(29,78,216,0.1); }
.pv-lv { font-size: 10.5px; padding: 1px 6px; border-radius: 6px; border: 1px solid; line-height: 16px; height: 18px; }
.pv-lv.lv-1 { color: #4b5563; border-color: rgba(75,85,99,0.4); background: rgba(75,85,99,0.08); }
.pv-lv.lv-2 { color: #9a3412; border-color: rgba(154,52,18,0.5); background: rgba(154,52,18,0.1); }
.pv-lv.lv-3 { color: #4b5563; border-color: rgba(75,85,99,0.5); background: rgba(75,85,99,0.1); }
.pv-lv.lv-4 { color: #b45309; border-color: rgba(180,83,9,0.5); background: rgba(180,83,9,0.1); }
.pv-lv.lv-5 { color: #6d28d9; border-color: rgba(109,40,217,0.5); background: rgba(109,40,217,0.12); }
.pv-tags { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
/* 封面 / 正文块：浅灰背景 + 标签栏，浅色 dialog 下也清楚区分 */
.pv-section {
  margin-bottom: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f9fafb;
  overflow: hidden;
}
.pv-section-label {
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
  padding: 7px 12px;
  background: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
  letter-spacing: 0.5px;
}
.pv-section-cover img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  margin: 12px auto;
  object-fit: contain;
  background: #fff;
  border-radius: 6px;
}
.pv-body {
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.75;
  color: #1f2937;
  max-height: 52vh;
  overflow-y: auto;
  background: #fff;
}
.pv-body img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 8px auto;
  background: #f3f4f6;
}
.pv-body img.pv-inline-img {
  display: inline-block;
  max-width: 360px;
  max-height: 280px;
  object-fit: contain;
  background: #fff;
  border: 1px solid #e5e7eb;
}
.pv-reject { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 13px; }
.pv-reject b { color: #b91c1c; margin-right: 4px; }
.an-title { color: var(--t1); font-weight: 600; font-size: 13px; }
.an-content { color: var(--t3); font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.an-pin-tag { margin-left: 6px; vertical-align: middle; }
/* 公告表：让标题/内容列可省略，所有列同屏可见 */
.an-table.el-table th.el-table__cell,
.an-table.el-table td.el-table__cell { vertical-align: middle; }
.an-table .cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-table .an-content { white-space: normal; -webkit-line-clamp: 2; }
/* 移动端窄屏：隐藏「发布人」「发布时间」次要列 */
@media (max-width: 720px) {
  .an-table .an-extra { display: none; }
}
.g-cover { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: var(--bg-2); }
.g-noimg { font-size: 22px; display: inline-block; width: 44px; text-align: center; }
.g-name { color: var(--t1); }
.pk-title { color: var(--t2); font-size: 13px; }
.u-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.u-name { font-size: 13px; color: var(--t1); font-weight: 600; }
.u-uname { font-size: 11px; color: var(--t3); }
.u-role { margin-right: 4px; }
.a-table {
  margin-top: 4px;
  background: var(--bg-1);
}
.dlg-user {
  font-size: 13px;
  color: var(--t2);
  margin-bottom: 12px;
}
.dlg-roles {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.dlg-boards {
  width: 100%;
  margin-top: 6px;
}
.mb-list {
  max-height: 460px;
  min-height: 120px;
  overflow: auto;
  border: 1px solid #dcdfe6;
  border-radius: 10px;
  margin-top: 4px;
  background: #fff;
  padding: 4px;
}
.mb-game-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.mb-game-item:hover {
  background: #f5f7fa;
}
.mb-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
  color: #303133;
}
.mb-table th,
.mb-table td {
  border-bottom: 1px solid #ebeef5;
  padding: 7px 8px;
  text-align: center;
  background: #fff;
}
.mb-table tbody tr:hover td {
  background: #f5f7fa;
}
.mb-table thead th {
  background: #f5f7fa;
  color: #303133;
  position: sticky;
  top: 0;
  z-index: 2;
  box-shadow: 0 1px 0 #dcdfe6;
}
.mb-game-col {
  text-align: left !important;
  min-width: 120px;
  position: sticky;
  left: 0;
  z-index: 1;
  background: #fff;
}
.mb-board-col {
  width: 78px;
}
.mb-emoji {
  margin-right: 3px;
}
.mb-game {
  font-weight: 600;
  color: #303133;
}
.mb-tip {
  margin-left: 6px;
  font-size: 10px;
  color: #67c23a;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 6px;
  padding: 0 5px;
}
.dlg-warn {
  margin-bottom: 12px;
}
/* ---- 用户 / 游戏 / 公告 卡片化（与举报队列、帖子审核同风格） ---- */
.users-section {
  background: linear-gradient(180deg, rgba(124, 92, 255, 0.06), rgba(124, 92, 255, 0.02));
  border: 1px solid rgba(124, 92, 255, 0.16);
}
.users-section .a-section-title { color: #8b74ff; }
.games-section {
  background: linear-gradient(180deg, rgba(56, 178, 172, 0.06), rgba(56, 178, 172, 0.02));
  border: 1px solid rgba(56, 178, 172, 0.16);
}
.games-section .a-section-title { color: #38b2ac; }
.announcements-section {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.06), rgba(245, 158, 11, 0.02));
  border: 1px solid rgba(245, 158, 11, 0.16);
}
.announcements-section .a-section-title { color: #e8a33d; }
/* 用户卡片 */
.a-user-item {
  align-items: center;
}
.a-u-ava {
  flex: none;
  background: var(--bg-3);
  font-weight: 700;
}
.a-u-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--t1);
}
.a-u-uname {
  font-size: 12px;
  color: var(--t3);
}
/* 9-07：版主卡片显示「负责游戏」标签 */
.a-u-game {
  margin-left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.a-u-game-tag {
  font-size: 11px !important;
  padding: 0 8px !important;
  height: 20px !important;
  line-height: 18px !important;
}
/* 游戏卡片 */
.a-g-cover {
  width: 54px;
  height: 54px;
  border-radius: 10px;
  object-fit: cover;
  background: var(--bg-3);
  border: 1px solid var(--border);
  flex: none;
}
.a-g-noimg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--brand);
}
.a-g-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
}
/* 公告卡片 */
.a-an-item .a-item-main {
  align-self: center;
}
.a-an-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--t1);
}
.a-an-content {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.6;
  word-break: break-all;
}
/* 改角色弹窗：游戏选择小节标题 */
.dlg-roles-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 0 6px;
}
.dlg-roles-title .rt {
  font-size: 13px;
  font-weight: 700;
  color: var(--t1);
}
.mb-list.role-games {
  max-height: 260px;
  min-height: 80px;
}
/* 单选版主游戏：圆圈 + 选中高亮（替代原多选 checkbox） */
.mb-game-item.selected {
  background: rgba(124, 92, 255, 0.14);
}
.mb-radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #b8bdc7;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  transition: border-color 0.15s;
}
.mb-game-item.selected .mb-radio {
  border-color: var(--brand, #7c5cff);
}
.mb-radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand, #7c5cff);
}
</style>
