# SCM 多仓库上下文路由

## 问题模式

VS Code 扩展里最常见的误判，是直接把 workspaceFolders[0] 当成 Git 仓库，或者把生成结果永远写到 git.repositories[0]。这在以下场景会直接出错：

- 工作区根目录不是 Git 仓库，仓库位于子目录
- 一个工作区里有多个 Git 仓库
- 用户从 SCM 标题栏点击的是某个具体仓库的按钮

## 正确策略

### 1. 仓库解析顺序

优先级应该固定为：

1. 命令上下文中的 URI 或 rootUri
2. 当前活动编辑器所属文件的 URI
3. 手动弹出仓库选择

不要直接退回到第一个仓库。

### 2. 匹配方式

对每个候选 URI，用路径包含关系匹配 Git API 的 repositories，并选择最长前缀命中的仓库。

这样可以处理：

- 子目录仓库
- 多仓库并列
- 嵌套仓库

### 3. 读写必须使用同一仓库

一旦解析出目标仓库，后续所有 Git 操作都必须绑定到同一个仓库上下文：

- `git diff --cached` 的 cwd 使用该仓库根目录
- `git diff` 的 cwd 使用该仓库根目录
- SCM 输入框写入使用该仓库的 `repository.inputBox`

不要出现“diff 从 A 仓库读取，提交信息写到 B 仓库输入框”的情况。

## 最小实现清单

- 提供一个 `resolveGitRepository(commandContext)` 函数
- 支持从 `rootUri`、`resourceUri`、`uri`、`sourceControl` 等对象递归提取候选 URI
- 提供活动编辑器回退
- 多仓库时使用 QuickPick 让用户明确选择
- 解析完成后，把 `repository` 和 `workspacePath` 一起向下传递

## 反模式

- 使用 `workspace.workspaceFolders?.[0]` 作为 Git 仓库真相来源
- 使用 `git.repositories[0]` 作为默认写入目标
- 在多仓库场景静默降级到第一个仓库
- 只修 diff 读取，不修输入框写入