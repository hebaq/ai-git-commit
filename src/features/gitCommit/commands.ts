import * as vscode from 'vscode';

import { generateAICommitMessage } from './aiProviders';
import { getAIConfig } from './config';
import { CONFIG_NAMESPACE } from './constants';
import { ensureGitRepository, getDiffForCommitMessage, getWorkspacePath, setCommitMessage } from './git';
import type { AIConfig } from './types';

async function analyzeChangesAndGenerateMessage(diffOutput: string, config: AIConfig): Promise<string> {
	console.log('开始分析变更并生成消息...');

	if (!config.apiKey) {
		throw new Error('请先在设置中配置 API Key');
	}

	try {
		console.log('尝试使用 AI 生成提交信息...');
		return await generateAICommitMessage(diffOutput, config);
	} catch (error) {
		console.error('AI 生成失败:', error);
		throw new Error(`AI 生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
	}
}

export async function handleGenerateCommitMessage(): Promise<void> {
	console.log('开始生成提交信息...');

	const workspacePath = getWorkspacePath();
	await ensureGitRepository(workspacePath);

	const diffOutput = await getDiffForCommitMessage(workspacePath);
	const config = getAIConfig();
	const commitMessage = await analyzeChangesAndGenerateMessage(diffOutput, config);

	await setCommitMessage(commitMessage);
	vscode.window.showInformationMessage('提交信息生成成功');
}

export function handleOpenSettings(): void {
	vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_NAMESPACE);
}
