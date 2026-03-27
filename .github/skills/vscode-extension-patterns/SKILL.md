---
name: vscode-extension-patterns
description: VS Code 扩展开发常见模式，重点覆盖 SCM 多仓库上下文路由、Git 仓库选择回退链路、OutputChannel 日志封装边界，以及原生 TreeView 配置管理与 WebviewView 取舍。适用于修复多仓库 Git 行为、SCM 按钮命令上下文错误、输出面板日志设计、侧边栏配置管理实现。
---

# VS Code Extension Patterns

## 适用场景

- 修复 SCM 标题栏按钮、命令面板、快捷键在多仓库工作区下行为不一致的问题
- 需要根据点击来源把命令路由到正确的 Git 仓库，而不是默认工作区根目录
- 为扩展设计输出面板日志层，并判断是否应该抽到 shared 或 core
- 需要在侧边栏实现“更像 VS Code 原生面板”的配置管理，而不是自定义网页式界面
- 需要在 TreeView 中实现配置列表、行内命令、拖拽排序、字段列表式编辑

## 核心规则

1. 不要把工作区根目录默认当成 Git 仓库，优先使用 vscode.git API 暴露的 repositories。
2. SCM 相关命令要有明确的仓库解析回退链路：命令上下文 -> 当前活动文件 -> 手动选择。
3. 一旦解析出目标仓库，后续 diff 读取和 SCM 输入框写入都必须使用同一个 repository 对象，避免读写错仓库。
4. OutputChannel 日志封装优先保持在功能域内；只有在出现第二个真实消费方且日志行为一致时，才抽取共享层。

## 推荐工作流

1. 从命令参数中提取 rootUri、resourceUri、uri 等候选路径。
2. 用路径包含关系在 repositories 中做最长前缀匹配，解决嵌套仓库或子目录仓库问题。
3. 如果命令参数没有提供足够上下文，则退回到当前活动编辑器所属仓库。
4. 如果仍存在多个候选仓库，则弹出选择框，而不是偷偷回退到第一个仓库。
5. 日志层只负责通道创建、级别控制、错误标准化和显示策略，不要过早承载业务逻辑。

## 详细文档

- [SCM 多仓库上下文路由](docs/scm-multi-repo-context.md)
- [OutputChannel 日志抽象边界](docs/output-channel-boundary.md)
- [TreeView 原生配置管理](docs/treeview-native-management.md)