/*
 * LaFu AI 智能提交 - VS Code 扩展
 * Copyright (c) 2025 LaFu Code. All rights reserved.
 *
 * 本软件受版权法保护。未经 LaFu Code 明确书面许可，
 * 禁止复制、修改、分发或以其他方式使用本软件的任何部分。
 *
 * 联系方式: lafucode@proton.me
 * 官网: https://lafucode.com
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';
import OpenAI from 'openai';
import axios from 'axios';

const exec = promisify(cp.exec);

// 扩展唯一标识 - 用于防抄袭检测
const EXTENSION_ID = 'lafucode-ai-git-commit-v1.0';
const AUTHOR_SIGNATURE = 'LaFu Code © 2025';

// AI 配置接口
interface AIConfig {
	provider: 'openai' | 'claude' | 'gemini' | 'tongyi' | 'local';
	apiKey: string;
	model: string;
	language: 'zh' | 'en';
	commitStyle: 'conventional' | 'simple' | 'detailed';
	maxTokens: number;
	temperature: number;
	openaiBaseUrl?: string;
	claudeBaseUrl?: string;
}

// 获取 AI 配置
function getAIConfig(): AIConfig {
	const config = vscode.workspace.getConfiguration('lafucode-ai-git-commit');
	const provider = config.get('aiProvider', 'local') as 'openai' | 'claude' | 'gemini' | 'tongyi' | 'local';

	// 调试信息 - 检查配置读取
	const language = config.get('language', 'zh');
	console.log('=== 配置读取调试 ===');
	console.log('Provider:', provider);
	console.log('Language:', language);

	// 如果没有读取到配置，尝试显示提示
	if (language === 'zh' && provider === 'local') {
		console.log('使用默认配置 - 如果是 VSIX 安装，请检查设置是否正确保存');
	}

	// 根据提供商获取对应的环境变量
	let envApiKey = '';
	switch (provider) {
		case 'openai':
			envApiKey = process.env.OPENAI_API_KEY || '';
			break;
		case 'claude':
			envApiKey = process.env.CLAUDE_API_KEY || '';
			break;
		case 'gemini':
			envApiKey = process.env.GEMINI_API_KEY || '';
			break;
		case 'tongyi':
			envApiKey = process.env.TONGYI_API_KEY || '';
			break;
	}

	// 获取模型配置，如果没有配置则根据提供商设置默认值
	let model = config.get('model', '');

	// 首先检查提供商特定的环境变量
	let envModel = '';
	switch (provider) {
		case 'openai':
			envModel = process.env.OPENAI_MODEL || '';
			break;
		case 'claude':
			envModel = process.env.CLAUDE_MODEL || '';
			break;
		case 'gemini':
			envModel = process.env.GEMINI_MODEL || '';
			break;
		case 'tongyi':
			envModel = process.env.TONGYI_MODEL || '';
			break;
	}

	// 优先级：环境变量 > VS Code 设置 > 提供商默认值
	if (envModel) {
		model = envModel;
	} else if (!model) {
		// 如果没有配置，设置提供商默认模型
		switch (provider) {
			case 'openai':
				model = 'gpt-3.5-turbo';
				break;
			case 'claude':
				model = 'claude-3-sonnet-20240229';
				break;
			case 'gemini':
				model = 'gemini-pro';
				break;
			case 'tongyi':
				model = 'qwen-turbo';
				break;
			default:
				model = 'local';
		}
	}

	// 获取 OpenAI baseUrl
	const openaiBaseUrl = config.get('openaiBaseUrl', '') || process.env.OPENAI_BASE_URL || '';

	// 获取 Claude baseUrl
	const claudeBaseUrl = config.get('claudeBaseUrl', '') || process.env.CLAUDE_BASE_URL || '';

	return {
		provider: provider,
		apiKey: config.get('apiKey', '') || envApiKey,
		model: model,
		language: config.get('language', 'zh'),
		commitStyle: config.get('commitStyle', 'conventional'),
		maxTokens: config.get('maxTokens', 200),
		temperature: config.get('temperature', 0.3),
		openaiBaseUrl: openaiBaseUrl || undefined,
		claudeBaseUrl: claudeBaseUrl || undefined
	};
}

export function activate(context: vscode.ExtensionContext) {
	console.log('🚀 LaFu AI 智能提交扩展已激活!');
	console.log(`📝 ${AUTHOR_SIGNATURE} - 扩展ID: ${EXTENSION_ID}`);

	const generateDisposable = vscode.commands.registerCommand('lafucode-ai-git-commit.generateCommitMessage', async () => {
		// 显示生成中的状态提示
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在生成提交信息...",
			cancellable: false
		}, async (_progress) => {
			try {
				await generateCommitMessage();
			} catch (error) {
				console.error('生成提交信息时出错:', error);
				// 在左下角显示错误提示
				vscode.window.showErrorMessage(
					`生成提交信息失败: ${error instanceof Error ? error.message : '未知错误'}`,
					'重试'
				).then(selection => {
					if (selection === '重试') {
						vscode.commands.executeCommand('lafucode-ai-git-commit.generateCommitMessage');
					}
				});
			}
		});
	});

	const settingsDisposable = vscode.commands.registerCommand('lafucode-ai-git-commit.openSettings', () => {
		vscode.commands.executeCommand('workbench.action.openSettings', 'lafucode-ai-git-commit');
	});

	context.subscriptions.push(generateDisposable, settingsDisposable);
}

async function generateCommitMessage() {
	console.log('🎯 开始生成提交信息...');

	// 获取当前工作区
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		console.log('❌ 没有找到工作区文件夹');
		throw new Error('请在 Git 仓库中打开项目');
	}

	const workspacePath = workspaceFolder.uri.fsPath;

	try {
		// 检查是否是Git仓库
		await exec('git status', { cwd: workspacePath });
	} catch (error) {
		throw new Error('当前目录不是 Git 仓库');
	}

	try {
		// 获取Git差异
		const { stdout: diffOutput } = await exec('git diff --cached', { cwd: workspacePath });

		if (!diffOutput.trim()) {
			// 如果没有暂存的更改，检查工作区更改
			const { stdout: workingDiff } = await exec('git diff', { cwd: workspacePath });
			if (!workingDiff.trim()) {
				throw new Error('没有检测到代码变更，请先修改代码并使用 git add 暂存更改');
			}
			throw new Error('检测到工作区有变更，请使用 git add 暂存更改后再生成提交信息');
		}

		// 分析差异并生成提交信息
		const commitMessage = await analyzeChangesAndGenerateMessage(diffOutput);

		// 将生成的提交信息设置到SCM输入框
		await setCommitMessage(commitMessage);

		// 显示成功提示
		vscode.window.showInformationMessage('✅ 提交信息生成成功！');
	} catch (error) {
		// 这里的错误会被外层的 withProgress 捕获
		throw error;
	}
}

async function analyzeChangesAndGenerateMessage(diffOutput: string): Promise<string> {
	console.log('📊 开始分析变更并生成消息...');
	const config = getAIConfig();

	// 如果选择本地生成或没有配置 API Key，使用本地规则
	if (config.provider === 'local' || !config.apiKey) {
		console.log('🏠 使用本地规则生成提交信息');
		return generateLocalCommitMessage(diffOutput);
	}

	try {
		console.log('🤖 尝试使用 AI 生成提交信息...');
		// 使用 AI 生成提交信息
		return await generateAICommitMessage(diffOutput, config);
	} catch (error) {
		console.error('AI 生成失败，回退到本地生成:', error);
		// 显示 AI 失败的警告，但继续使用本地生成
		vscode.window.showWarningMessage(
			`AI 生成失败，已自动切换到本地生成: ${error instanceof Error ? error.message : '未知错误'}`
		);
		// AI 失败时回退到本地生成
		return generateLocalCommitMessage(diffOutput);
	}
}

// 本地规则生成提交信息
function generateLocalCommitMessage(diffOutput: string): string {
	console.log('🔧 执行本地规则生成提交信息');
	const config = getAIConfig();
	const lines = diffOutput.split('\n');
	const addedLines = lines.filter(line => line.startsWith('+')).length;
	const removedLines = lines.filter(line => line.startsWith('-')).length;
	const modifiedFiles = new Set<string>();

	// 提取修改的文件
	for (const line of lines) {
		if (line.startsWith('diff --git')) {
			const match = line.match(/diff --git a\/(.*?) b\/(.*?)$/);
			if (match) {
				modifiedFiles.add(match[1]);
			}
		}
	}

	// 分析变更类型
	let changeType = 'update';
	if (addedLines > removedLines * 2) {
		changeType = 'add';
	} else if (removedLines > addedLines * 2) {
		changeType = 'remove';
	} else if (modifiedFiles.size === 1) {
		changeType = 'fix';
	}

	// 生成提交信息
	const fileList = Array.from(modifiedFiles).slice(0, 3).join(', ');
	const isZh = config.language === 'zh';
	const moreFiles = modifiedFiles.size > 3 ?
		(isZh ? ` 等 ${modifiedFiles.size - 3} 个文件` : ` and ${modifiedFiles.size - 3} more files`) : '';

	let commitMessage = '';
	if (isZh) {
		// 中文提交信息
		switch (changeType) {
			case 'add':
				commitMessage = `feat: 为 ${fileList}${moreFiles} 添加新功能`;
				break;
			case 'remove':
				commitMessage = `refactor: 从 ${fileList}${moreFiles} 移除无用代码`;
				break;
			case 'fix':
				commitMessage = `fix: 修复 ${fileList}${moreFiles}`;
				break;
			default:
				commitMessage = `update: 更新 ${fileList}${moreFiles}`;
		}
	} else {
		// 英文提交信息
		switch (changeType) {
			case 'add':
				commitMessage = `feat: add new features to ${fileList}${moreFiles}`;
				break;
			case 'remove':
				commitMessage = `refactor: remove unused code from ${fileList}${moreFiles}`;
				break;
			case 'fix':
				commitMessage = `fix: update ${fileList}${moreFiles}`;
				break;
			default:
				commitMessage = `update: modify ${fileList}${moreFiles}`;
		}
	}

	// 添加详细信息
	if (addedLines > 0 || removedLines > 0) {
		if (isZh) {
			commitMessage += `\n\n- 新增 ${addedLines} 行\n- 删除 ${removedLines} 行`;
		} else {
			commitMessage += `\n\n- Added ${addedLines} lines\n- Removed ${removedLines} lines`;
		}
	}

	return commitMessage;
}

// 创建 OpenAI 客户端（支持不同厂商）
function createOpenAIClient(config: AIConfig): OpenAI {
	const clientConfig: any = {
		apiKey: config.apiKey,
	};

	// 根据不同厂商配置不同的 baseURL
	switch (config.provider) {
		case 'openai':
			// OpenAI 支持自定义 baseUrl
			if (config.openaiBaseUrl) {
				clientConfig.baseURL = config.openaiBaseUrl;
				console.log('🌐 使用自定义 OpenAI Base URL:', config.openaiBaseUrl);
			}
			break;
		case 'claude':
			// Claude 暂时不支持 OpenAI 格式，保持原有实现
			break;
		case 'gemini':
			// Gemini 暂时不支持 OpenAI 格式，保持原有实现
			break;
		case 'tongyi':
			// 通义灵码支持 OpenAI 兼容格式
			clientConfig.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
			break;
	}

	return new OpenAI(clientConfig);
}

// AI 生成提交信息
async function generateAICommitMessage(diffOutput: string, config: AIConfig): Promise<string> {
	const prompt = buildPrompt(diffOutput, config);

	// 对于支持 OpenAI 格式的厂商，使用统一的 SDK
	if (config.provider === 'openai' || config.provider === 'tongyi') {
		return await callWithOpenAISDK(prompt, config);
	}

	// 对于不支持 OpenAI 格式的厂商，保持原有实现
	switch (config.provider) {
		case 'claude':
			return await callClaude(prompt, config);
		case 'gemini':
			return await callGemini(prompt, config);
		default:
			throw new Error(`不支持的 AI 提供商: ${config.provider}`);
	}
}

// 构建 AI 提示词
function buildPrompt(diffOutput: string, config: AIConfig): string {
	// 限制 diff 长度以避免超出 token 限制
	// const truncatedDiff = diffOutput.length > 3000 ?
	// 	diffOutput.substring(0, 3000) + '\n... (truncated)' : diffOutput;
	const truncatedDiff = diffOutput;
	if (config.language === 'zh') {
		// 中文提示词
		const stylePrompt = {
			'conventional': '约定式提交规范格式（如：feat: 添加新功能）',
			'simple': '简洁的一行中文描述',
			'detailed': '详细的多行中文描述，包含变更原因和影响'
		}[config.commitStyle];

		// 根据风格调整提示词
		const isConventional = config.commitStyle === 'conventional';
		const headerDescription = isConventional
			? '遵循 Conventional Commits 规范，格式：<type>(<scope>): <subject>'
			: '使用简洁清晰的描述';

		return `你是一个专业的 Git 提交信息生成助手。请根据以下代码变更生成中文提交信息，风格：${stylePrompt}。

## Git Diff 格式说明
- 以 "-" 开头的行：表示删除的旧代码
- 以 "+" 开头的行：表示添加的新代码
- 需要同时分析 "-" 和 "+" 行来理解变更的本质

## 代码变更

\`\`\`diff
${truncatedDiff}
\`\`\`

## 严格要求

1. **输出格式**：直接输出提交信息，不要任何前缀说明或解释
2. **禁止使用**：Markdown 代码块标记（不要 \`\`\`）
3. **禁止说明性文字**：不要说"根据代码变更"、"以下是"、"或者"等
4. **唯一性**：只返回一个最佳的提交信息
5. **语言**：必须使用中文
6. **格式规范**：${headerDescription}

${isConventional ? `## 提交类型识别规则

准确识别变更类型，参考以下规则：

- **feat** (✨ 新功能)：新增功能、特性
- **fix** (🐛 修复)：修复 Bug、问题
- **docs** (📝 文档)：文档、注释变更
- **style** (🎨 格式)：代码格式调整（不影响代码逻辑）
- **refactor** (♻️ 重构)：重构代码（既不是新功能也不是修复）
- **perf** (⚡ 性能)：性能优化
- **test** (✅ 测试)：添加或修改测试
- **chore** (🔧 杂项)：构建工具、依赖、配置文件等变更
- **ci** (👷 CI/CD)：CI/CD 配置和脚本
- **revert** (⏪ 回退)：回退之前的提交` : ''}

## 变更类型判断

- **只有 "-" 行**：代码删除
- **只有 "+" 行**：代码新增
- **同时有 "-" 和 "+" 行**：代码修改、替换或重构，需分析具体含义

## 输出格式示例

${isConventional ? `<type>(<scope>): <subject>

<body>

- **Header**（首行）：≤ 72 字符，祈使语气（如"添加"、"修复"、"更新"）
- **Body**（正文）：说明动机、实现细节、影响范围
- **Scope**（范围）：可选，如 ui、api、core 等

## 示例

feat(auth): 添加用户登录功能

实现了基于 JWT 的用户认证系统，包含：
- 用户名密码登录表单
- Token 存储和自动刷新
- 登录状态持久化` : config.commitStyle === 'simple' ? `一行简洁描述即可，无需详细说明

## 示例

添加用户登录功能` : `提供详细的多行描述

## 示例

添加用户登录功能

本次更新实现了完整的用户认证系统，基于 JWT Token 机制。主要包含用户名密码登录表单、Token 存储和自动刷新机制、以及登录状态的持久化。这为后续的权限管理和用户个性化功能奠定了基础。`}`;
	} else {
		// 英文提示词
		const stylePrompt = {
			'conventional': 'Conventional Commits format (e.g., feat: add new feature)',
			'simple': 'concise one-line description',
			'detailed': 'detailed multi-line description with reasons and impact'
		}[config.commitStyle];

		// 根据风格调整提示词
		const isConventional = config.commitStyle === 'conventional';
		const headerDescription = isConventional
			? 'Follow Conventional Commits specification, format: <type>(<scope>): <subject>'
			: 'Use clear and concise description';

		return `You are a professional Git commit message generator. Generate a commit message based on code changes with style: ${stylePrompt}.

## Git Diff Format
- Lines starting with "-": removed old code
- Lines starting with "+": added new code
- Analyze both "-" and "+" lines to understand the nature of changes

## Code Changes

\`\`\`diff
${truncatedDiff}
\`\`\`

## Strict Requirements

1. **Output Format**: Output commit message directly, no prefix or explanation
2. **Forbidden**: Markdown code block markers (no \`\`\`)
3. **Forbidden Phrases**: Do NOT say "Based on the code changes", "Here is", "Or", etc.
4. **Uniqueness**: Return only ONE best commit message
5. **Language**: Must be in English
6. **Format**: ${headerDescription}

${isConventional ? `## Commit Type Identification Rules

Accurately identify change type following these rules:

- **feat** (✨ New feature): Add new functionality or features
- **fix** (🐛 Bug fix): Fix bugs or issues
- **docs** (📝 Documentation): Documentation or comments changes
- **style** (🎨 Code style): Code formatting (no logic changes)
- **refactor** (♻️ Refactor): Code refactoring (neither feature nor fix)
- **perf** (⚡ Performance): Performance improvements
- **test** (✅ Testing): Add or modify tests
- **chore** (🔧 Maintenance): Build tools, dependencies, config files
- **ci** (👷 CI/CD): CI/CD configuration and scripts
- **revert** (⏪ Revert): Revert previous commits` : ''}

## Change Type Analysis

- **Only "-" lines**: Code deletion
- **Only "+" lines**: Code addition
- **Both "-" and "+" lines**: Code modification, replacement, or refactoring - analyze specific meaning

## Output Format Example

${isConventional ? `<type>(<scope>): <subject>

<body>

- **Header** (first line): ≤ 72 chars, imperative mood (e.g., "add", "fix", "update")
- **Body**: Explain motivation, implementation details, impact scope
- **Scope**: Optional, e.g., ui, api, core

## Example

feat(auth): add user login feature

Implemented JWT-based user authentication system with:
- Username/password login form
- Token storage and auto-refresh
- Login state persistence` : config.commitStyle === 'simple' ? `One-line concise description, no details needed

## Example

Add user login feature` : `Provide detailed multi-line description

## Example

Add user login feature

This update implements a complete user authentication system based on JWT token mechanism. It includes username/password login form, token storage and auto-refresh mechanism, and login state persistence. This lays the foundation for subsequent permission management and user personalization features.`}`;
	}
}

// 清理 AI 返回的提交信息
function cleanCommitMessage(message: string): string {
	let cleaned = message.trim();

	// 移除常见的 Markdown 代码块标记
	cleaned = cleaned.replace(/^```[\s\S]*?\n/, '');  // 移除开始的代码块
	cleaned = cleaned.replace(/\n```[\s\S]*?$/, '');  // 移除结尾的代码块
	cleaned = cleaned.replace(/^```|```$/g, '');      // 移除单独的代码块标记

	// 移除常见的说明性前缀（中文）
	const chinesePrefixes = [
		/^根据提供的代码变更[，,：:].*/,
		/^这是一个.*/,
		/^以下是.*[：:]\s*/,
		/^或者更简洁的版本[：:]\s*/,
		/^或者[：:]\s*/,
		/^建议的提交信息[：:]\s*/,
		/^提交信息[：:]\s*/
	];

	// 移除常见的说明性前缀（英文）
	const englishPrefixes = [
		/^Based on the (?:provided )?code changes[,:].*/i,
		/^Here (?:is|are) the.*/i,
		/^Or a more concise version[:]?\s*/i,
		/^Or[:]?\s*/i,
		/^Suggested commit message[:]?\s*/i,
		/^Commit message[:]?\s*/i
	];

	for (const prefix of [...chinesePrefixes, ...englishPrefixes]) {
		cleaned = cleaned.replace(prefix, '');
	}

	// 如果返回了多个选项（用"或者"等关键词分隔），只取第一个
	// 注意：不要把正常的提交信息（标题+详细描述）误认为是多选项
	const optionKeywords = /\n\s*(?:或者|或|Or)\s*[:：]?\s*\n/i;
	if (optionKeywords.test(cleaned)) {
		// 确实有多个选项，按关键词分割
		const parts = cleaned.split(optionKeywords);
		cleaned = parts[0].trim();
	}

	return cleaned.trim();
}

// 使用 OpenAI SDK 统一调用（支持 OpenAI 和通义灵码）
async function callWithOpenAISDK(prompt: string, config: AIConfig): Promise<string> {
	const client = createOpenAIClient(config);

	const response = await client.chat.completions.create({
		model: config.model,
		messages: [
			{
				role: 'user',
				content: prompt
			}
		],
		max_tokens: config.maxTokens,
		temperature: config.temperature
	});

	const rawMessage = response.choices[0].message.content?.trim() || '';
	return cleanCommitMessage(rawMessage);
}



// Claude API 调用
async function callClaude(prompt: string, config: AIConfig): Promise<string> {
	// 构建 API 端点
	const baseUrl = config.claudeBaseUrl || 'https://api.anthropic.com';
	const apiEndpoint = `${baseUrl}/v1/messages`;

	console.log('📡 Claude API 端点:', apiEndpoint);

	const response = await axios.post(apiEndpoint, {
		model: config.model,
		max_tokens: config.maxTokens,
		temperature: config.temperature,
		messages: [
			{
				role: 'user',
				content: prompt
			}
		]
	}, {
		headers: {
			'x-api-key': config.apiKey,
			'Content-Type': 'application/json',
			'anthropic-version': '2023-06-01'
		}
	});

	const rawMessage = response.data.content[0].text.trim();
	return cleanCommitMessage(rawMessage);
}

// Gemini API 调用
async function callGemini(prompt: string, config: AIConfig): Promise<string> {
	const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`, {
		contents: [
			{
				parts: [
					{
						text: prompt
					}
				]
			}
		],
		generationConfig: {
			maxOutputTokens: config.maxTokens,
			temperature: config.temperature
		}
	}, {
		headers: {
			'Content-Type': 'application/json'
		}
	});

	const rawMessage = response.data.candidates[0].content.parts[0].text.trim();
	return cleanCommitMessage(rawMessage);
}



async function setCommitMessage(message: string) {
	// 获取Git扩展
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		return;
	}

	// 获取Git API
	const git = gitExtension.getAPI(1);
	if (git.repositories.length === 0) {
		return;
	}

	// 设置提交信息到第一个仓库
	const repository = git.repositories[0];
	repository.inputBox.value = message;
}

export function deactivate() {
	console.log('🔴 lafucode-ai-git-commit extension is deactivated!');
}
