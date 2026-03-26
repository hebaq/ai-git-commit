# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 🎯 项目概览

**Hebai AI Git Commit** - 一个 VS Code 扩展，使用 AI 自动生成 Git 提交信息。扩展支持多个 AI 提供商（OpenAI、Claude、Gemini、通义），在 AI 失败时会智能回退到本地生成。

**技术栈：**
- TypeScript + ES2022
- VS Code Extension API
- Webpack 5 打包工具
- OpenAI SDK（统一客户端，支持 OpenAI 和通义）
- Axios 直接调用 API（Claude、Gemini）

## 📋 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式 - 监听文件变化并自动重编译
pnpm run watch

# 生产构建
pnpm run build

# 编译调试版本
pnpm run compile

# 打包 VSIX 文件
pnpm run package

# 发布到 VS Code 应用市场
vsce publish
```

**调试/测试：**
- 在 VS Code 中按 `F5` 启动扩展调试（在新 VS Code 窗口中运行）
- 控制台日志显示在"调试控制台"标签页

## 🏗️ 架构概览

### 核心流程

```
generateCommitMessage()
    ├─ 验证 Git 仓库存在
    ├─ 通过 `git diff --cached` 获取暂存更改
    └─ analyzeChangesAndGenerateMessage()
         ├─ 尝试：AI 生成（若配置了提供商 + API 密钥存在）
         │   ├─ OpenAI/通义 → callWithOpenAISDK()
         │   ├─ Claude → callClaude()
         │   └─ Gemini → callGemini()
         └─ 回退：generateLocalCommitMessage()（AI 错误或本地提供商）

    └─ setCommitMessage() → 注入到 VS Code SCM 输入框
```

### 关键组件

**配置系统（`getAIConfig()`）：**
- 从 VS Code 工作区配置读取设置（`hebai-ai-git-commit.*`）
- 回退到环境变量：`OPENAI_API_KEY`、`CLAUDE_API_KEY`、`GEMINI_API_KEY`、`TONGYI_API_KEY`
- 若未配置，按提供商自动选择默认模型

**Diff 分析：**
- 使用 `git diff --cached` 提取暂存更改
- 统计新增/删除行数
- 识别修改的文件
- 分析变更模式判断类型（add/fix/refactor/update）

**AI 提供商：**
1. **OpenAI/通义** - 使用统一的 OpenAI SDK，通义使用 baseURL 覆盖
2. **Claude** - 直接 Axios 调用 `https://api.anthropic.com/v1/messages`
3. **Gemini** - 直接 Axios 调用 Google 生成 API
4. **本地** - 基于规则的分析，无需 API 调用

**提示词工程：**
- 支持多语言提示词（中文/英文）
- 提交信息风格选项：conventional | simple | detailed
- Diff 截断为 3000 字符以防止 Token 溢出
- 可配置的 temperature 和 max_tokens

### 本地生成算法（`generateLocalCommitMessage()`）

1. 解析 Diff，统计新增/删除行数，提取文件路径
2. 判断变更类型：
  - `docs`：仅文档文件变更
  - `test`：仅测试文件变更
  - `ci`：仅 CI 文件变更
  - `build`：仅构建/依赖/配置文件变更
  - `feat`：新增行数明显大于删除行数
  - `refactor`：删除行数明显大于新增行数
  - `fix`：单个文件修改
  - `chore`：默认回退
3. 使用文件列表（前 3 个文件）和行数统计格式化消息
4. 针对每种变更类型的语言特定模板

## 📁 文件结构

```
src/
├── extension.ts                  # 扩展入口与命令注册
└── features/
  └── gitCommit/
    ├── commands.ts           # 提交信息生成流程
    ├── config.ts             # VS Code 配置读取
    ├── diffAnalysis.ts       # Diff 摘要与 scope 分析
    ├── prompt.ts             # AI 提示词构建
    ├── aiProviders.ts        # OpenAI/Claude/Gemini/openai-response 调用
    ├── git.ts                # Git 与 SCM 交互
    ├── constants.ts          # 功能常量
    ├── types.ts              # 共享类型
    └── cleanCommitMessage.ts # AI 输出清洗
dist/                     # Webpack 输出（extension.js）
webpack.config.js         # 单个 Node.js 目标配置
tsconfig.json            # 启用严格模式
package.json             # VSCode 扩展清单 + 脚本
README.md                # 用户文档
```

## 🔧 常见开发任务

### 添加新的 AI 提供商

1. 更新 `AIConfig` 接口，添加新的提供商类型
2. 在 `getAIConfig()` 中添加环境变量映射 case
3. 实现 `callNewProvider()` 函数（参考 `callClaude()` 或 `callGemini()` 的模式）
4. 在 `generateAICommitMessage()` 的 switch 语句中添加 case
5. 更新 package.json 配置 schema，新增 enum 值

### 修改提交信息格式

- 编辑 `generateLocalCommitMessage()` 中的模板字符串（中英文部分）
- 更新 `buildPrompt()` 中的 AI 生成指导
- 调整 `stylePrompt` 对象以支持不同的 `commitStyle` 选项

### 调试生成失败

1. 打开 VS Code 开发者工具（F12）
2. 在控制台标签页查看详细日志（已用表情符号前缀标注）
3. 常见日志：
   - `❌ 没有工作区文件夹` → 不在 Git 仓库中
   - `📊 开始分析变更` → Diff 解析已启动
   - `🤖 尝试使用 AI 生成` → API 调用已启动
   - `AI 生成失败，回退到本地生成` → 提供商错误，含错误信息

### 错误处理策略

- **验证错误** → 用户可见的错误消息（如"不是 Git 仓库"）
- **AI API 错误** → 警告通知 + 自动回退到本地生成
- **无暂存更改** → 信息提示区分"无变更"和"未暂存变更"

## ⚙️ 配置键参考

所有设置存储在 `hebai-ai-git-commit` 作用域下：
- `aiProvider` - 提供商选择
- `apiKey` - 可选 API 密钥（优先使用环境变量：`OPENAI_API_KEY`、`CLAUDE_API_KEY` 等）
- `model` - 模型名称，支持任意自定义值
  - 环境变量：`OPENAI_MODEL`、`CLAUDE_MODEL`、`GEMINI_MODEL`、`TONGYI_MODEL`
- `language` - 提交信息语言
- `commitStyle` - 格式风格
- `maxTokens` - API 响应最大长度（50-1000）
- `temperature` - AI 创意程度（0-1）
- `openaiBaseUrl` - OpenAI 自定义 Base URL（留空使用官方）
  - 环境变量：`OPENAI_BASE_URL`
- `claudeBaseUrl` - Claude 自定义 Base URL（留空使用官方）
  - 环境变量：`CLAUDE_BASE_URL`

## 🐛 已知实现细节

1. **模块化设计**：按入口、配置、diff 分析、prompt、provider、Git 交互拆分，便于后续改名和扩展功能
2. **Diff 截断**：限制为 3000 字符以防止 Token 溢出；不影响提交质量
3. **回退可靠性**：本地生成保证即使所有 AI 提供商都失败也能生成提交信息
4. **VS Code Git API**：使用 Git 扩展公开 API 将提交信息注入输入框
5. **源代码映射**：生产构建中包含（`hidden-source-map`）用于调试已发布扩展
6. **自定义 BaseURL 支持**：
   - OpenAI：支持自定义 baseUrl（用于代理、私有部署或兼容 API）
   - Claude：支持自定义 baseUrl（用于代理或兼容实现）
   - 优先级：环境变量 > VS Code 设置 > 官方默认 API

## 🌐 自定义 BaseURL 使用指南

### OpenAI 代理/私有部署

**场景 1：使用代理访问 OpenAI API**
```bash
# 设置环境变量
export OPENAI_BASE_URL="http://localhost:8000/v1"
export OPENAI_API_KEY="your-api-key"
```

**场景 2：VS Code 设置中配置**
```json
{
  "hebai-ai-git-commit.aiProvider": "openai",
  "hebai-ai-git-commit.openaiBaseUrl": "http://localhost:8000/v1",
  "hebai-ai-git-commit.apiKey": "your-api-key"
}
```

### Claude 代理/兼容实现

**场景 1：使用代理访问 Claude API**
```bash
# 设置环境变量
export CLAUDE_BASE_URL="https://proxy.example.com"
export CLAUDE_API_KEY="your-api-key"
```

**场景 2：私有部署 Claude 兼容服务**
```json
{
  "hebai-ai-git-commit.aiProvider": "claude",
  "hebai-ai-git-commit.claudeBaseUrl": "https://your-custom-domain.com",
  "hebai-ai-git-commit.model": "claude-3-sonnet-20240229"
}
```

### 调试自定义 BaseURL

检查 VS Code 开发者工具控制台中的日志：
- `🌐 使用自定义 OpenAI Base URL: ...` - 表示 OpenAI 使用了自定义 baseUrl
- `📡 Claude API 端点: ...` - 显示 Claude 实际使用的 API 端点

## 🎯 自定义模型支持

### 概述
扩展支持任意模型名称，不限于预设列表。这对以下场景特别有用：
- 私有部署的模型服务
- OpenAI 兼容 API 的其他模型
- Claude 的最新模型版本
- 内部微调的模型

### 配置方式

#### 方式 1：VS Code 设置中指定
```json
{
  "hebai-ai-git-commit.aiProvider": "openai",
  "hebai-ai-git-commit.model": "gpt-4-turbo"
}
```

#### 方式 2：环境变量（推荐）
支持提供商特定的模型环境变量：

```bash
# OpenAI 自定义模型
export OPENAI_MODEL="gpt-4o"

# Claude 自定义模型
export CLAUDE_MODEL="claude-3-opus-20240229"

# Gemini 自定义模型
export GEMINI_MODEL="gemini-1.5-pro"

# 通义灵码自定义模型
export TONGYI_MODEL="qwen-max"
```

#### 优先级顺序
1. 提供商特定的环境变量（`OPENAI_MODEL` 等）
2. VS Code 设置中的 `model` 字段
3. 提供商的默认模型（如 `gpt-3.5-turbo` for OpenAI）

### 实际使用场景

#### 场景 1：使用最新的 Claude 模型
```json
{
  "hebai-ai-git-commit.aiProvider": "claude",
  "hebai-ai-git-commit.model": "claude-3-5-sonnet-20241022",
  "hebai-ai-git-commit.claudeBaseUrl": "https://api.anthropic.com",
  "hebai-ai-git-commit.apiKey": "your-api-key"
}
```

#### 场景 2：使用 OpenAI 兼容的私有部署模型
```bash
# 设置环境变量
export OPENAI_BASE_URL="https://your-private-llm.com/v1"
export OPENAI_API_KEY="your-key"
export OPENAI_MODEL="your-custom-model-name"
```

#### 场景 3：通过代理使用 OpenAI 并指定特定模型
```bash
export OPENAI_BASE_URL="http://localhost:8000/v1"
export OPENAI_MODEL="gpt-4-turbo"
export OPENAI_API_KEY="sk-xxx"
```

## 📦 构建和打包信息

- **Webpack 目标**：Node.js（VS Code 运行时环境）
- **Bundle 大小**：通过生产构建最小化
- **入口点**：`dist/extension.js`（在 package.json `main` 字段中声明）
- **外部依赖**：bundled：axios、openai（vscode 模块为外部）
- **激活事件**：`workspaceContains:.git`（仅在 Git 仓库中激活）

## 🔐 安全考虑

- API 密钥从 VS Code 设置或环境变量读取（推荐方式）
- 扩展中无硬编码凭证
- 仅当配置了 AI 提供商时，才将 Diff 内容发送到外部 API
- 用户必须明确批准扩展权限
