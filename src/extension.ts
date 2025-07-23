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
	if (!model) {
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

	return {
		provider: provider,
		apiKey: config.get('apiKey', '') || envApiKey,
		model: model,
		language: config.get('language', 'zh'),
		commitStyle: config.get('commitStyle', 'conventional'),
		maxTokens: config.get('maxTokens', 200),
		temperature: config.get('temperature', 0.3)
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
			// 使用默认的 OpenAI API
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
	const truncatedDiff = diffOutput.length > 3000 ?
		diffOutput.substring(0, 3000) + '\n... (truncated)' : diffOutput;

	if (config.language === 'zh') {
		// 中文提示词
		const stylePrompt = {
			'conventional': '约定式提交规范格式（如：feat: 添加新功能）',
			'simple': '简洁的一行中文描述',
			'detailed': '详细的多行中文描述，包含变更原因和影响'
		}[config.commitStyle];

		return `请根据以下代码变更生成中文的 Git 提交信息，使用${stylePrompt}。

基于以下代码变更：

\`\`\`diff
${truncatedDiff}
\`\`\`

要求：
1. 必须使用中文描述代码变更的内容和目的
2. 遵循指定的格式规范
3. 保持简洁明了
4. 只返回中文提交信息，不要其他解释`;
	} else {
		// 英文提示词
		const stylePrompt = {
			'conventional': 'Conventional Commits format (e.g., feat: add new feature)',
			'simple': 'concise one-line description',
			'detailed': 'detailed multi-line description with reasons and impact'
		}[config.commitStyle];

		return `Please generate an English Git commit message using ${stylePrompt} based on the following code changes:

\`\`\`diff
${truncatedDiff}
\`\`\`

Requirements:
1. Accurately describe the content and purpose of code changes in English
2. Follow the specified format specification
3. Keep it concise and clear
4. Only return the English commit message, no other explanations`;
	}
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

	return response.choices[0].message.content?.trim() || '';
}



// Claude API 调用
async function callClaude(prompt: string, config: AIConfig): Promise<string> {
	const response = await axios.post('https://api.anthropic.com/v1/messages', {
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

	return response.data.content[0].text.trim();
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

	return response.data.candidates[0].content.parts[0].text.trim();
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
