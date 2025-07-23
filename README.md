# LaFu AI Git Commit

🤖 一个智能的 VS Code 扩展，使用 AI 自动生成 Git 提交信息。

## 📖 目录

1. [功能特性](#-功能特性)
2. [快速开始](#-快速开始)
3. [配置指南](#️-配置指南)
4. [AI 提供商](#-ai-提供商)
5. [使用方法](#-使用方法)
6. [自定义设置](#-自定义设置)
7. [故障排除](#-故障排除)
8. [开发说明](#️-开发说明)

---

## ✨ 功能特性

- 🤖 **AI 智能生成** - 支持 OpenAI、Claude、Gemini、通义灵码
- 🔧 **本地规则生成** - 无需 API 的本地智能分析
- 💡 **一键操作** - 点击输入框内的 💡 按钮即可生成
- ⚙️ **丰富配置** - 自定义 AI 提供商、语言、风格等
- 🔄 **智能回退** - AI 失败时自动使用本地生成
- 🌍 **多语言支持** - 支持中文和英文提交信息
- 📊 **多种风格** - Conventional Commits、简洁、详细等风格

## 🚀 快速开始

### 立即使用（无需配置）

1. 在 Git 仓库中修改代码
2. 运行 `git add .` 暂存更改
3. 打开源码管理面板（`Ctrl+Shift+G`）
4. 点击输入框内的 💡 **生成提交信息** 按钮
5. 自动生成提交信息！

### 启用 AI 功能

1. **打开设置**：按 `Ctrl+,` 搜索 "LaFu AI Git Commit"
2. **配置 AI 提供商**：选择 OpenAI/Claude/Gemini/通义灵码
3. **设置 API 密钥**：输入密钥或使用环境变量
4. **开始使用**：点击 💡 按钮享受 AI 生成

---

## ⚙️ 配置指南

### 配置顺序（按逻辑排列）

#### 1. 🤖 AI 提供商

选择用于生成提交信息的 AI 服务：

- **本地规则生成**（默认，无需 API）
- **OpenAI** (GPT-3.5/GPT-4)
- **Anthropic Claude**
- **Google Gemini**
- **阿里云通义灵码**

#### 2. � API 密钥

配置 AI 服务的访问密钥：

- 支持直接输入或环境变量
- **建议使用环境变量**确保安全

#### 3. 🤖 模型选择

根据选择的提供商输入对应模型：

- **OpenAI**: `gpt-3.5-turbo`, `gpt-4`, `gpt-4-turbo`, `gpt-4o`
- **Claude**: `claude-3-sonnet-20240229`, `claude-3-haiku-20240307`
- **Gemini**: `gemini-pro`, `gemini-1.5-pro`, `gemini-1.5-flash`
- **通义灵码**: `qwen-turbo`, `qwen-plus`, `qwen-max`

#### 4. ⚙️ 生成设置

- **语言**: 中文（默认）/ English
- **提交风格**: Conventional Commits（默认）/ 简洁 / 详细

#### 5. 🔧 高级设置

- **Max Tokens**: 50-1000（默认 200）
- **Temperature**: 0-1（默认 0.3，控制创造性）

### VS Code 设置界面配置

#### 打开设置

1. **快捷键**：`Ctrl+,`
2. **菜单**：文件 → 首选项 → 设置
3. **命令面板**：`Ctrl+Shift+P` → "Preferences: Open Settings"

#### 搜索配置

在设置搜索框中输入：`lafucode-ai-git-commit`

---

## 🤖 AI 提供商

### OpenAI

- **模型**: GPT-3.5-turbo, GPT-4, GPT-4-turbo, GPT-4o
- **获取密钥**: [OpenAI API Keys](https://platform.openai.com/api-keys)
- **环境变量**: `OPENAI_API_KEY`
- **特点**: 成熟稳定，支持多种模型

### Anthropic Claude

- **模型**: claude-3-sonnet-20240229, claude-3-haiku-20240307
- **获取密钥**: [Anthropic Console](https://console.anthropic.com/)
- **环境变量**: `CLAUDE_API_KEY`
- **特点**: 安全可靠，适合企业使用

### Google Gemini

- **模型**: gemini-pro, gemini-1.5-pro, gemini-1.5-flash
- **获取密钥**: [Google AI Studio](https://makersuite.google.com/app/apikey)
- **环境变量**: `GEMINI_API_KEY`
- **特点**: Google 技术，多模态支持

### 阿里云通义灵码 ⭐

- **模型**: qwen-turbo, qwen-plus, qwen-max, qwen-max-longcontext
- **获取密钥**: [阿里云 DashScope](https://dashscope.console.aliyun.com/)
- **环境变量**: `TONGYI_API_KEY`
- **特点**: 中文优化，国内访问稳定

### 本地规则生成

- **无需 API**: 完全本地运行
- **无网络要求**: 离线可用
- **免费使用**: 无任何费用
- **特点**: 快速稳定，作为 AI 的回退方案

---

## 🎯 使用方法

### 基本使用流程

1. **修改代码**: 在 Git 仓库中进行代码修改
2. **暂存更改**: `git add .` 或选择性暂存文件
3. **打开源码管理**: 按 `Ctrl+Shift+G`
4. **生成提交信息**: 点击输入框内的 💡 按钮
5. **检查并提交**: 检查生成的信息，点击提交

### 生成效果对比

#### 本地生成

```
feat: add new features to src/extension.ts

- Added 120 lines
- Removed 15 lines
```

#### AI 生成（OpenAI）

```
feat: implement AI-powered commit message generation

Add comprehensive AI integration supporting multiple providers including
OpenAI, Claude, Gemini, and Tongyi. Includes intelligent fallback
mechanism and configurable generation styles.
```

#### AI 生成（通义灵码）

```
feat: 实现AI驱动的提交信息生成功能

集成多个AI提供商支持，包括OpenAI、Claude、Gemini和通义灵码，
添加智能回退机制和可配置的生成风格，提升开发者提交信息质量。
```

---

## 🎨 自定义设置

### 环境变量配置（推荐）

#### Windows

```cmd
setx OPENAI_API_KEY "your-openai-key"
setx TONGYI_API_KEY "your-tongyi-key"
```

#### macOS/Linux

```bash
export OPENAI_API_KEY="your-openai-key"
export TONGYI_API_KEY="your-tongyi-key"
echo 'export OPENAI_API_KEY="your-openai-key"' >> ~/.bashrc
```

### 配置示例

#### OpenAI 配置

```json
{
  "lafucode-ai-git-commit.aiProvider": "openai",
  "lafucode-ai-git-commit.model": "gpt-3.5-turbo",
  "lafucode-ai-git-commit.language": "zh",
  "lafucode-ai-git-commit.commitStyle": "conventional"
}
```

#### 通义灵码配置

```json
{
  "lafucode-ai-git-commit.aiProvider": "tongyi",
  "lafucode-ai-git-commit.model": "qwen-turbo",
  "lafucode-ai-git-commit.language": "zh",
  "lafucode-ai-git-commit.commitStyle": "conventional"
}
```

### 按钮图标自定义

当前使用 `$(lightbulb)` 💡 图标，可选图标：

- `$(robot)` 🤖 - 机器人
- `$(sparkle)` ✨ - 闪光
- `$(lightbulb)` 💡 - 灯泡（当前）
- `$(git-commit)` 📝 - Git 提交
- `$(tools)` 🔧 - 工具

修改方法：在 `package.json` 中更改 `"icon"` 字段

---

## 🔧 故障排除

### 常见问题

#### 按钮不显示

- 确保在 Git 仓库中工作
- 检查扩展是否激活
- 重启 VS Code

#### API 密钥无效

- 检查 API 密钥是否正确
- 确认 API 服务是否有余额
- 验证环境变量是否设置正确

#### 网络连接问题

- 检查网络连接
- 国内用户访问 OpenAI 可能需要代理
- 尝试使用通义灵码（国内访问更稳定）

#### AI 生成失败

- 扩展会自动回退到本地生成
- 检查控制台错误信息
- 验证模型名称是否正确

### 调试方法

1. 按 `F12` 打开开发者工具
2. 查看 Console 标签页的错误信息
3. 在 Network 标签页检查 API 请求

---

## 🛠️ 开发说明

### 技术架构

- **OpenAI SDK**: 统一调用 OpenAI 和通义灵码
- **Axios**: 调用 Claude 和 Gemini 专有 API
- **智能回退**: AI 失败时自动使用本地生成
- **TypeScript**: 完整的类型安全

### 项目结构

```
lafucode-ai-git-commit/
├── src/extension.ts          # 扩展主要代码
├── package.json              # 扩展配置和依赖
├── README.md                 # 项目说明（本文档）
└── dist/                     # 编译输出
```

### 编译和测试

```bash
# 安装依赖
pnpm install

# 编译扩展
pnpm run compile

# 启动调试
按 F5 键
```

### 系统要求

- VS Code 1.102.0+
- Git 已安装并配置
- 当前工作区必须是 Git 仓库

---

## 🎉 总结

LaFu AI Git Commit 提供了完整的 AI 驱动提交信息生成解决方案：

1. **即开即用**: 默认本地生成，无需配置
2. **AI 增强**: 支持主流 AI 提供商
3. **智能回退**: 确保功能始终可用
4. **高度可配置**: 满足不同用户需求
5. **安全可靠**: 支持环境变量配置

现在就开始使用吧！按 `F5` 启动调试，体验 AI 驱动的智能提交信息生成！🚀

## 📄 许可证

MIT

## 🔒 版权声明

© 2025 LaFu Code. All rights reserved.

"LaFu AI 智能提交" 是 LaFu Code 的商标。未经许可，禁止使用本商标或类似标识。

本扩展的核心算法、用户界面设计和品牌标识均受版权法保护。
