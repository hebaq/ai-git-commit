/*
 * Hebai AI 智能提交 - VS Code 扩展
 * Copyright (c) 2026 Hebai. All rights reserved.
 *
 * 本软件受版权法保护。未经 Hebai 明确书面许可，
 * 禁止复制、修改、分发或以其他方式使用本软件的任何部分。
 *
 * 联系方式: hebai@proton.me
 * 官网: https://hebai.com
 */

import * as vscode from 'vscode';
import { handleGenerateCommitMessage, handleOpenSettings } from './features/gitCommit/commands';
import {
	AUTHOR_SIGNATURE,
	EXTENSION_ID,
	GENERATE_COMMIT_MESSAGE_COMMAND,
	GENERATE_PROGRESS_TITLE,
	OPEN_SETTINGS_COMMAND
} from './features/gitCommit/constants';
import { disposeOutputChannel, logDebug, logError, showOutputChannel } from './features/gitCommit/output';

export function activate(context: vscode.ExtensionContext) {
	logDebug('Hebai AI 智能提交扩展已激活');
	logDebug(`${AUTHOR_SIGNATURE} - 扩展ID: ${EXTENSION_ID}`);

	const generateDisposable = vscode.commands.registerCommand(GENERATE_COMMIT_MESSAGE_COMMAND, async (...commandArgs: unknown[]) => {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: GENERATE_PROGRESS_TITLE,
			cancellable: false
		}, async () => {
			try {
				await handleGenerateCommitMessage(commandArgs.length <= 1 ? commandArgs[0] : commandArgs);
			} catch (error) {
				logError('生成提交信息时出错:', error);
				showOutputChannel(true);
				vscode.window.showErrorMessage(
					`生成提交信息失败: ${error instanceof Error ? error.message : '未知错误'}`,
					'重试'
				).then(selection => {
					if (selection === '重试') {
						vscode.commands.executeCommand(GENERATE_COMMIT_MESSAGE_COMMAND);
					}
				});
			}
		});
	});

	const settingsDisposable = vscode.commands.registerCommand(OPEN_SETTINGS_COMMAND, () => {
		handleOpenSettings();
	});

	context.subscriptions.push(generateDisposable, settingsDisposable, { dispose: disposeOutputChannel });
}

export function deactivate() {
	logDebug('hebai-ai-git-commit extension is deactivated');
	disposeOutputChannel();
}
