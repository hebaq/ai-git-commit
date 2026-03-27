import * as vscode from 'vscode';

import { generateAICommitMessage } from './aiProviders';
import { getAIConfig, getProviderProfileById, resolveAIConfigFromProfile } from './config';
import { ensureGitRepository, getDiffForCommitMessage, resolveGitRepository, setCommitMessage } from './git';
import { testAIConfigConnection } from './modelTest';
import { logDebug, logError, logGeneratedCommitMessage, logInfo, showOutputChannel } from './output';
import { openProviderManagementPanel } from './providerManagementPanel';
import type { AIConfig } from './types';

function resolveProfileIdFromCommandArg(commandArg?: unknown): string | undefined {
	if (typeof commandArg === 'string' && commandArg) {
		return commandArg;
	}

	if (commandArg && typeof commandArg === 'object' && 'profile' in commandArg) {
		const profile = (commandArg as { profile?: { id?: unknown } }).profile;
		if (profile && typeof profile.id === 'string' && profile.id) {
			return profile.id;
		}
	}

	return undefined;
}

async function analyzeChangesAndGenerateMessage(diffOutput: string, config: AIConfig): Promise<string> {
	logDebug('开始分析变更并生成消息...');

	if (!config.apiKey) {
		throw new Error('请先在设置中配置 API Key');
	}

	try {
		logDebug('尝试使用 AI 生成提交信息...');
		return await generateAICommitMessage(diffOutput, config);
	} catch (error) {
		logError('AI 生成失败:', error);
		throw new Error(`AI 生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
	}
}

export async function handleGenerateCommitMessage(commandContext?: unknown): Promise<void> {
	logDebug('开始生成提交信息...');

	const { repository, workspacePath } = await resolveGitRepository(commandContext);
	logDebug(`目标 Git 仓库: ${workspacePath}`);

	await ensureGitRepository(workspacePath);

	const diffOutput = await getDiffForCommitMessage(workspacePath);
	const config = getAIConfig();
	const commitMessage = await analyzeChangesAndGenerateMessage(diffOutput, config);

	await setCommitMessage(commitMessage, repository);
	logGeneratedCommitMessage(commitMessage);
	logInfo(`提交信息已写入源码管理输入框: ${workspacePath}`);
	showOutputChannel(true);
	vscode.window.showInformationMessage('提交信息生成成功');
}

export async function handleTestModelConnection(commandArg?: unknown): Promise<void> {
	logDebug('开始测试模型连接...');

	const profileId = resolveProfileIdFromCommandArg(commandArg);
	const config = profileId
		? (() => {
			const profile = getProviderProfileById(profileId);
			if (!profile) {
				throw new Error('找不到要测试的 AI 配置');
			}

			return resolveAIConfigFromProfile(profile);
		})()
		: getAIConfig();
	await testAIConfigConnection(config);
	showOutputChannel(true);

	vscode.window.showInformationMessage(
		`模型连接测试成功: ${config.profileName} / ${config.model}`,
		'查看输出'
	).then(selection => {
		if (selection === '查看输出') {
			showOutputChannel(true);
		}
	});
}

export function handleOpenSettings(): void {
	openProviderManagementPanel();
}
