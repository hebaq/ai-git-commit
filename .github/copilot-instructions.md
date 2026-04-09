# Project Guidelines

## Code Style

- 使用 TypeScript 严格类型风格，保持现有的 import 排序、制表符缩进和早返回写法，参考 src/extension.ts 与 src/features/gitCommit/commands.ts。
- 变更保持最小化，不做无关重构，不随意改动命令 ID、配置键、TreeView item context、QuickPick 文案或输出日志文案。
- 复用已有功能域内封装。Git 提交相关日志统一走 src/features/gitCommit/output.ts，不要把业务逻辑塞进日志层。

## Architecture

- 这是一个 VS Code 扩展，入口在 src/extension.ts；这里只做命令注册和功能面板挂载，具体逻辑下沉到 features 目录。
- src/features/gitCommit 负责提交信息生成、AI 配置管理、Git 仓库解析、SCM 远程仓库视图、文件历史面板等 Git 相关功能。
- src/features/deploy 负责部署服务器、工作区部署目标、SSH 上传与远程终端。
- 多仓库 Git 行为依赖 vscode.git API，仓库解析与回退链路集中在 src/features/gitCommit/git.ts。涉及 SCM、活动文件、命令上下文时，优先沿用这里的解析逻辑，不要默认工作区根目录就是目标仓库。
- 配置管理与部署管理优先使用原生 TreeView 模式，参考 src/features/gitCommit/providerManagementPanel.ts 与 src/features/deploy/serverManagementPanel.ts；文件历史才使用 WebviewPanel。

## Build And Verify

- 安装依赖：pnpm install
- 开发编译：pnpm run watch
- 单次编译：pnpm run compile
- 生产构建：pnpm run build
- 打包 VSIX：pnpm run package
- 当前 package.json 没有测试脚本。不要假设存在 test 或 lint 命令，若需要额外验证，优先运行 compile 或 build。

## Conventions

- 这个扩展的核心用户输出是中文。提交信息默认是 Conventional Commits 风格中文文案，例如 fix:、feat:、refactor:。
- AI 生成流程要求模型返回 git commit -m 命令，再由扩展提取 -m 内容写入 SCM 输入框。修改 prompt、清洗或解析逻辑时，必须保持这条链路一致。
- AI 失败时不要绕过错误处理链路；应保留输出面板日志、用户提示和必要的回退行为。
- 处理多仓库、SCM 标题栏按钮、远程仓库视图时，优先遵循 .github/skills/vscode-extension-patterns/ 与其 docs 中总结的模式，而不是自行发明新路由方式。
- 处理配置管理 UI 时，优先延续现有原生 TreeView 交互，不要轻易改成 Webview。
- 涉及敏感信息（API Key、SSH 密钥、密码）时，优先沿用现有配置/secret storage 流程，不要把凭据写入普通配置或日志。

## Documentation

- 用户功能、配置方式和开发说明优先参考 README.md。
- 历史架构背景和模块职责可参考 CLAUDE.md。
- VS Code 扩展专项模式优先参考 .github/skills/vscode-extension-patterns/SKILL.md 及以下文档：
  - .github/skills/vscode-extension-patterns/docs/scm-multi-repo-context.md
  - .github/skills/vscode-extension-patterns/docs/output-channel-boundary.md
  - .github/skills/vscode-extension-patterns/docs/treeview-native-management.md
  - .github/skills/vscode-extension-patterns/docs/webview-history-chat-integration.md