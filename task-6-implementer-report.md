# Task 6 实现报告

## 完成内容

- 编辑卡片固定显示步骤 `02`，移除置信度徽标，并增加“返回选择方式”。
- 新增可访问的清除确认对话框：默认聚焦“取消”，Escape 等同取消，提交期间禁用重复操作。
- 新增 `WORKFLOW_RESET`、`draftNeedsResetConfirmation` 和带 `operationId` 的填表状态动作；重置仅清除商品整理状态，保留登录态与顶级页面。
- 侧边栏服务接入 `clearDraft()`；返回时依次等待草稿保存队列、清除持久化草稿、重置内存、删除本地媒体并运行孤立媒体清理补偿。
- 解析、AI 扩写、填表的迟到回调在返回后被丢弃；返回成功后焦点回到商品链接输入框。

## 验证

- 首先运行的新增 App 行为测试在基线上失败：缺少 `02`、返回操作和确认对话框。
- `pnpm vitest run tests/unit/confirm-dialog.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx tests/unit/storage.test.ts`：45 通过。
- `pnpm typecheck`：通过。
- 相关文件 ESLint：通过。
- `pnpm test`：21 个测试文件、177 个测试通过。
- `pnpm vitest run tests/unit/no-publish-action.test.ts`：2 个测试通过。

## 边界

- 未执行发布或构建动作。
- 未修改、暂存或提交 `entrypoints/sidepanel/styles.css`；其中现有未提交变更保持原样。
