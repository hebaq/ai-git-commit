import * as path from 'path';

import * as vscode from 'vscode';

import {
	FILE_HISTORY_PANEL_ID,
	FILE_HISTORY_PROGRESS_TITLE,
	OPEN_FILE_HISTORY_COMMAND
} from './constants';
import { ensureGitRepository, getFileHistory, getGitRelativePath, type GitFileHistoryEntry, resolveGitRepository } from './git';
import { logDebug, logError, logInfo } from './output';

interface FileHistoryWebviewState {
	entries: GitFileHistoryEntry[];
	fileUri: string;
	fileName: string;
	relativePath: string;
	workspaceName: string;
}

interface AddCommitToChatMessage {
	type: 'addCommitToChat';
	entry: GitFileHistoryEntry;
	fileUri: string;
	fileName: string;
	relativePath: string;
	workspaceName: string;
}

let currentPanel: vscode.WebviewPanel | undefined;

export function registerFileHistoryPanel(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand(OPEN_FILE_HISTORY_COMMAND, async (resource?: vscode.Uri, resources?: readonly vscode.Uri[]) => {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: FILE_HISTORY_PROGRESS_TITLE,
			cancellable: false
		}, async () => {
			try {
				await openFileHistoryPanel(context, resource, resources);
			} catch (error) {
				logError('打开文件历史时出错:', error);
				vscode.window.showErrorMessage(
					`打开文件历史失败: ${error instanceof Error ? error.message : '未知错误'}`
				);
			}
		});
	}));

	context.subscriptions.push({
		dispose: () => {
			currentPanel?.dispose();
			currentPanel = undefined;
		}
	});
}

async function openFileHistoryPanel(context: vscode.ExtensionContext, resource?: vscode.Uri, resources?: readonly vscode.Uri[]): Promise<void> {
	const fileUri = await resolveHistoryTargetFile(resource, resources);
	if (!fileUri) {
		vscode.window.showInformationMessage('请在资源管理器中选择一个文件查看历史');
		return;
	}

	const { workspacePath } = await resolveGitRepository(fileUri);
	await ensureGitRepository(workspacePath);

	const relativePath = getGitRelativePath(workspacePath, fileUri.fsPath);
	const entries = await getFileHistory(workspacePath, fileUri.fsPath);
	if (entries.length === 0) {
		vscode.window.showInformationMessage(`文件 ${path.basename(fileUri.fsPath)} 暂无 Git 历史记录`);
		return;
	}

	const panel = getOrCreatePanel(context);
	const workspaceName = path.basename(workspacePath) || workspacePath;
	const state: FileHistoryWebviewState = {
		entries,
		fileUri: fileUri.toString(),
		fileName: path.basename(fileUri.fsPath),
		relativePath,
		workspaceName
	};

	panel.title = `文件历史: ${state.fileName}`;
	panel.webview.html = await getWebviewHtml(context, panel.webview, state);
	panel.reveal(vscode.ViewColumn.Active);
	logInfo(`已打开文件历史: ${relativePath}`);
	logDebug(`文件历史条目数: ${entries.length}`);
}

async function resolveHistoryTargetFile(resource?: vscode.Uri, resources?: readonly vscode.Uri[]): Promise<vscode.Uri | undefined> {
	const candidates = new Map<string, vscode.Uri>();
	if (resource) {
		candidates.set(resource.toString(), resource);
	}

	for (const uri of resources || []) {
		candidates.set(uri.toString(), uri);
	}

	for (const uri of candidates.values()) {
		if (uri.scheme !== 'file') {
			continue;
		}

		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if ((stat.type & vscode.FileType.File) !== 0) {
				return uri;
			}
		} catch {
			continue;
		}
	}

	return undefined;
}

function getOrCreatePanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
	if (currentPanel) {
		return currentPanel;
	}

	currentPanel = vscode.window.createWebviewPanel(
		FILE_HISTORY_PANEL_ID,
		'文件历史',
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview')],
			retainContextWhenHidden: true
		}
	);

	currentPanel.webview.onDidReceiveMessage(message => {
		if (!message || typeof message !== 'object') {
			return;
		}

		if ('type' in message && message.type === 'renderError' && 'message' in message && typeof message.message === 'string') {
			logError('文件历史 Webview 渲染失败:', message.message);
			return;
		}

		if ('type' in message && message.type === 'copyCommitHash' && 'commitHash' in message && typeof message.commitHash === 'string') {
			void vscode.env.clipboard.writeText(message.commitHash).then(() => {
				const shortHash = 'shortHash' in message && typeof message.shortHash === 'string'
					? message.shortHash
					: message.commitHash.slice(0, 7);
				vscode.window.setStatusBarMessage(`已复制提交 ID: ${shortHash}`, 2500);
			}, (error: unknown) => {
				logError('复制提交 ID 失败:', error);
				vscode.window.showErrorMessage('复制提交 ID 失败');
			});
			return;
		}

		if ('type' in message && message.type === 'addCommitToChat') {
			void handleAddCommitToChat(context, message as AddCommitToChatMessage);
		}
	});

	currentPanel.onDidDispose(() => {
		currentPanel = undefined;
	});

	return currentPanel;
}

async function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview, state: FileHistoryWebviewState): Promise<string> {
	const templateUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview', 'fileHistory.html');
	const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview', 'fileHistory.css'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview', 'fileHistory.js'));
	const templateBytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder().decode(templateBytes);

	return template
		.replaceAll('{{cspSource}}', escapeHtml(webview.cspSource))
		.replaceAll('{{stylesheetUri}}', escapeHtml(stylesheetUri.toString()))
		.replaceAll('{{scriptUri}}', escapeHtml(scriptUri.toString()))
		.replaceAll('{{state}}', serializeForWebview(state));
}

function serializeForWebview(state: FileHistoryWebviewState): string {
	return Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

async function handleAddCommitToChat(context: vscode.ExtensionContext, message: AddCommitToChatMessage): Promise<void> {
	if (!message.entry || !message.entry.commitHash) {
		return;
	}

	const commands = await vscode.commands.getCommands(true);
	const openChatCommand = commands.includes('workbench.action.chat.open')
		? 'workbench.action.chat.open'
		: undefined;

	if (!openChatCommand) {
		vscode.window.showWarningMessage('未检测到可用的 Copilot Chat“打开聊天”命令');
		return;
	}

	try {
		await vscode.commands.executeCommand(openChatCommand, {
			query: buildCommitChatQuery(message),
			isPartialQuery: true,
			attachHistoryItemChanges: [{
				uri: vscode.Uri.parse(message.fileUri),
				historyItemId: message.entry.commitHash
			}]
		});
		vscode.window.setStatusBarMessage(`已发送提交到 Copilot Chat: ${message.entry.shortHash}`, 3000);
	} catch (error) {
		logError('发送提交到 Copilot Chat 失败:', error);
		void vscode.env.clipboard.writeText(message.entry.commitHash).then(() => {
			vscode.window.showErrorMessage('发送到 Copilot Chat 失败，已将提交 ID 复制到剪贴板，请手动粘贴到 Copilot Chat');
		}, () => {
			vscode.window.showErrorMessage('发送到 Copilot Chat 失败，请先打开一个 Copilot Chat 会话');
		});
	}
}

function buildCommitChatQuery(message: AddCommitToChatMessage): string {
	return `请基于提交 ${message.entry.shortHash}`;
}
