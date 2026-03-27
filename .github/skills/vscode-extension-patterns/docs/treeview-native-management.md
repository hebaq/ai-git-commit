# TreeView 原生配置管理

## 什么时候优先用 TreeView

如果用户明确想要“看起来像源码管理、测试、资源管理器那样的 VS Code 原生侧边栏面板”，优先使用 TreeView，而不是 WebviewView。

适合 TreeView 的典型场景：

- 配置列表展示
- 当前激活项标记
- 行内命令或右键菜单
- 标题栏新增、刷新、测试等操作
- 分组折叠结构
- 同组拖拽排序

## 不要误判 WebviewView

WebviewView 虽然显示在侧边栏位置，但内容依然是自定义 HTML/CSS/JS。

这意味着：

- 它默认不会自动长得像 VS Code 原生面板
- 你需要自己维护布局、主题适配、焦点样式和交互细节
- 如果目标是“原生感”，WebviewView 往往不是第一选择

## 推荐结构

对于配置管理类扩展，推荐采用两层结构：

1. 根分组节点，例如“AI 供应商”
2. 子配置节点，例如具体的 provider profile

这样可以自然支持：

- 折叠/展开
- 分组内排序
- 未来按 provider 或环境继续细分

## 推荐交互模式

### 列表与命令

- 使用 TreeItem 展示配置名称、provider、model 和激活状态
- 使用 `view/title` 菜单承载新增、刷新、测试当前激活配置
- 使用 `view/item/context` 菜单承载编辑、激活、测试、删除
- 行内命令只放最常用的 2 到 4 个动作，避免过载

### 编辑流程

如果字段不多但又不适合固定顺序向导，优先使用“字段列表式” QuickPick：

1. 先展示可编辑字段清单
2. 用户自由选择字段进入 InputBox/QuickPick 编辑
3. 支持在保存前直接测试当前草稿配置
4. 保存时统一校验

这种方式比固定的一步步向导更接近配置管理工具的心智模型。

## 拖拽排序

TreeView 内部排序可使用 `TreeDragAndDropController`：

- 在 `handleDrag` 中写入被拖动项的内部 mime 数据
- 在 `handleDrop` 中解析拖动项并重排列表
- 同组配置排序时，通常以“拖到某项前面”为最容易实现的默认语义
- 如果 dropped target 是根分组，可以将项目移动到组尾

对于重要排序场景，建议额外提供“上移 / 下移”命令作为拖拽的补充，而不是只保留拖拽。

## 配置持久化建议

如果配置主要通过侧边栏管理，不要把内部状态继续暴露在 Settings UI 中。

推荐做法：

- 继续使用 `workspace.getConfiguration()` 做持久化
- 内部保留诸如 `profiles`、`activeProfileId` 之类的键
- 但从 `package.json` 的 `contributes.configuration.properties` 中移除这些内部字段
- 只保留真正需要用户手动开关的设置，例如 debug logs

这样能避免用户在 settings 页看到大量本应由侧边栏维护的内部数据。

## 验证建议

在大改 TreeView、命令贡献或 package.json 视图结构后，不要只依赖 Problems 面板。

优先做两类验证：

1. `get_errors` 或语言服务静态检查
2. 真实构建，例如 `pnpm run build`

当文件被整段替换或模块结构刚发生变化时，语言服务偶尔会出现短暂的假阳性；真实构建结果更可靠。

## 反模式

- 用户想要原生侧边栏，却默认实现成 WebviewView
- 配置完全靠自定义网页编辑，但目标只是普通列表管理
- 把 `profiles`、`activeProfileId` 直接暴露给用户在 settings UI 手工维护
- 只有拖拽排序，没有任何命令式排序或刷新回退
- 固定顺序向导强迫用户一次次从第一项配置到最后一项