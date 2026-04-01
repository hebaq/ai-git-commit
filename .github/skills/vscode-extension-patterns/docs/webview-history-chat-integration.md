# Webview 历史与 Chat 集成

## 适用场景

当 VS Code 扩展需要提供以下能力时，这套模式可以直接复用：

- 在资源管理器右键文件后打开 Git 文件历史面板
- 左侧展示提交列表，右侧展示当前文件在某次提交中的 diff
- 右侧只保留增删代码，而不是原样输出整段 patch
- 从历史面板把当前提交发送到 Copilot Chat 继续讨论需求变更

## 什么时候用 WebviewPanel

如果界面是“列表 + 明细 + 自定义 diff 渲染”，优先使用 `WebviewPanel`，不要强行塞进 TreeView。

这类场景通常需要：

- 左右分栏布局
- 自定义代码高亮或 diff 配色
- 更细的滚动控制
- Web 风格交互按钮，例如“复制提交 ID”“发送到 Copilot Chat”

TreeView 更适合原生列表管理，不适合承担复杂 diff 视图。

## 不要长期内联 Webview 资源

当 Webview 开始出现大量 HTML、CSS、JS，或者要渲染 patch、代码块、复杂交互时，不要继续把内容内联在 TypeScript 模板字符串里。

推荐结构：

- `resources/webview/*.html` 放结构
- `resources/webview/*.css` 放样式
- `resources/webview/*.js` 放交互
- 扩展侧只负责读取模板、注入 URI 和状态数据

这样做的好处：

- 更容易维护和调试
- 减少模板字符串里的转义错误
- 降低 Webview 空白页概率

## Webview 空白页高发原因

### 1. 模板字符串里的脚本转义出错

典型坑点：把正则、换行、反斜杠直接写进内联脚本，例如 `split(/\r?\n/)` 之类的表达式。生成后的 HTML 很容易把脚本打断，最终表现为 Webview 只有骨架，没有任何内容。

更稳妥的做法：

- 把脚本拆到独立 JS 文件
- 扩展侧只注入纯数据

### 2. 直接内联大段 patch 数据

如果把完整 diff 文本直接拼进 `<script>`，补丁内容里的特殊字符可能破坏脚本解析。

更稳妥的做法：

- 将状态先 `JSON.stringify`
- 再做 base64 编码
- Webview 里通过 `data-*` 或独立脚本解码

## Webview 布局与滚动

“看起来设置了 overflow 却不能滚动”的常见根因，不是少写了一个 `overflow`，而是父容器缺少最小尺寸约束。

推荐结构：

- 外层使用 `display: grid`
- 高度使用 `grid-template-rows: auto minmax(0, 1fr)`
- 左右分栏使用 `grid-template-columns: minmax(280px, 340px) minmax(0, 1fr)`
- 需要滚动的容器补上 `min-height: 0`

关键点：

- 左侧历史列表单独滚动
- 右侧 diff 区单独滚动
- 切换提交后重置右侧滚动位置

## Git 文件历史读取模式

单文件历史推荐直接用：

```bash
git log --follow -p --date=short --format=%x1e%H%x1f%h%x1f%an%x1f%ad%x1f%s -- <file>
```

推荐解析字段：

- 完整 commit hash
- 短 hash
- 作者
- 日期
- 提交标题
- 当前文件在该提交里的 patch

这套格式足够支撑：

- 左侧提交列表
- 右侧提交详情
- 复制完整 commit ID
- 继续把提交发到聊天上下文

## Diff 展示要主动降噪

如果界面目标是“帮助用户快速理解需求变更”，不要原样展示整段 patch。

建议过滤掉：

- `diff --git ...`
- `index ...`
- `--- / +++`
- `@@ ... @@`
- `\ No newline at end of file`
- 普通上下文行

只保留 hunk 内真正的新增和删除代码行。

这样会更适合：

- 让用户快速扫改动
- 复制后给 AI 讨论需求变更
- 缩短大文件 diff 的阅读时间

## Copilot Chat 集成边界

### 不要误用 Copilot CLI 私有命令

`github.copilot.chat.copilotCLI.addSelection` 和 `github.copilot.chat.copilotCLI.addFileReference` 只适用于 Copilot CLI / Agent session。

如果在普通 Copilot Chat 里调用，常见现象是：

- 弹出“未连接任何 Copilot CLI 会话”
- 或提示无法将虚拟文件发送到 Copilot CLI

### 优先使用公开 Chat 打开命令

公开且更稳的入口是：

```ts
await vscode.commands.executeCommand('workbench.action.chat.open', {
  query: '...',
  isPartialQuery: true,
  attachHistoryItemChanges: [{
    uri: fileUri,
    historyItemId: commitHash,
  }],
});
```

这个模式的好处：

- 不依赖 Copilot CLI session
- 不需要临时打开编辑器选中文本
- 不会引入 Webview 闪屏
- 语义上更接近“把某次历史变更附加到聊天上下文”

### 不要承诺复刻原生附件 chip

VS Code / Copilot 内部确实可以在聊天输入框上方显示原生上下文附件 chip，但这不代表第三方扩展有稳定公开 API 可以一比一复用。

当前公开文档更偏向：

- `Chat participant`
- `Language model tool`
- `MCP tool`
- `Language Model API`

如果目标只是“让 AI 理解当前提交”，优先追求上下文真的进聊天，而不是强求复刻完全相同的原生外观。

## 推荐实现清单

1. Explorer 右键命令解析当前文件 URI
2. 复用多仓库 Git 路由逻辑找到目标仓库
3. 用 `git log --follow -p` 读取单文件提交历史
4. 用 WebviewPanel 做历史列表 + diff 详情布局
5. Webview 资源拆分到独立 HTML/CSS/JS 文件
6. diff 只显示增删代码行
7. 复制提交 ID 使用完整 hash
8. 发送到 Copilot Chat 时优先走 `workbench.action.chat.open`

## 反模式

- 在 TS 模板字符串里长期维护大段 HTML/CSS/JS
- 直接把完整 patch 文本拼进 `<script>`
- 只给 diff 容器写 `overflow: auto`，不处理父容器 `min-height: 0`
- 为了“发送到聊天”而临时打开编辑器、选中内容、再关闭
- 把 Copilot CLI 专用命令误当成普通 Copilot Chat 命令
- 没有验证公开 API 边界，就承诺实现原生聊天上下文 chip