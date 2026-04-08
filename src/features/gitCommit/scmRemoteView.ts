import * as vscode from 'vscode';

import {
	ADD_REMOTE_REPOSITORY_COMMAND,
	COPY_REMOTE_REPOSITORY_URL_COMMAND,
	DELETE_REMOTE_REPOSITORY_COMMAND,
	EDIT_REMOTE_REPOSITORY_COMMAND,
	FETCH_REMOTE_REPOSITORY_COMMAND,
	OPEN_REMOTE_REPOSITORY_MANAGEMENT_COMMAND,
	PUSH_TO_REMOTE_REPOSITORY_COMMAND,
	REFRESH_REMOTE_REPOSITORIES_COMMAND,
	REMOTE_REPOSITORY_EMPTY_ITEM_CONTEXT,
	REMOTE_REPOSITORY_ITEM_CONTEXT,
	REMOTE_REPOSITORY_MANAGEMENT_PANEL_TITLE,
	REMOTE_REPOSITORY_MANAGEMENT_VIEW_ID,
	REMOTE_REPOSITORY_ROOT_ITEM_CONTEXT,
	SHOW_REMOTE_REPOSITORY_COMMAND
} from './constants';
import {
	addGitRemote,
	deleteGitRemote,
	fetchGitRemote,
	getGitRemotes,
	listGitRepositories,
	pushGitRemote,
	renameGitRemote,
	resolveGitRepository,
	setGitRemoteUrl,
	type GitRemoteEntry,
	type GitRepositorySummary
} from './git';
import { logError } from './output';

let scmRemoteDataProvider: ScmRemoteTreeDataProvider | undefined;
let scmRemoteTreeView: vscode.TreeView<ScmRemoteTreeItem> | undefined;

type ScmRemoteTreeItem = RepositoryRootTreeItem | RemoteTreeItem | RemoteEmptyTreeItem;

class RepositoryRootTreeItem extends vscode.TreeItem {
	constructor(public readonly repository: GitRepositorySummary) {
		super(repository.label, vscode.TreeItemCollapsibleState.Expanded);
		this.id = `git-remote-root-${repository.workspacePath}`;
		this.description = repository.description;
		this.tooltip = repository.workspacePath;
		this.contextValue = REMOTE_REPOSITORY_ROOT_ITEM_CONTEXT;
		this.iconPath = new vscode.ThemeIcon('repo');
	}
}

class RemoteTreeItem extends vscode.TreeItem {
	constructor(
		public readonly repository: GitRepositorySummary,
		public readonly remote: GitRemoteEntry
	) {
		super(remote.name, vscode.TreeItemCollapsibleState.None);
		this.id = `git-remote-${repository.workspacePath}-${remote.name}`;
		this.description = remote.fetchUrl || remote.pushUrl || '无 URL';
		this.tooltip = new vscode.MarkdownString([
			`**${remote.name}**`,
			`- 仓库: ${repository.label}`,
			`- Fetch: ${remote.fetchUrl || '未设置'}`,
			`- Push: ${remote.pushUrl || '未设置'}`
		].join('\n'));
		this.contextValue = REMOTE_REPOSITORY_ITEM_CONTEXT;
		this.iconPath = new vscode.ThemeIcon(remote.name === 'origin' ? 'repo' : 'cloud');
	}
}

class RemoteEmptyTreeItem extends vscode.TreeItem {
	constructor(public readonly repository?: GitRepositorySummary) {
		super(repository ? '未配置远程仓库' : '未检测到 Git 仓库', vscode.TreeItemCollapsibleState.None);
		this.id = repository
			? `git-remote-empty-${repository.workspacePath}`
			: 'git-remote-empty-workspace';
		this.description = repository ? '点击右上角添加' : undefined;
		this.tooltip = repository ? `${repository.label} 尚未配置 remote` : '当前工作区未检测到 Git 仓库';
		this.contextValue = repository ? REMOTE_REPOSITORY_EMPTY_ITEM_CONTEXT : undefined;
		this.iconPath = new vscode.ThemeIcon('info');
	}
}

class ScmRemoteTreeDataProvider implements vscode.TreeDataProvider<ScmRemoteTreeItem> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ScmRemoteTreeItem | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
		updateScmRemoteViewMetadata();
	}

	getTreeItem(element: ScmRemoteTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ScmRemoteTreeItem): Promise<ScmRemoteTreeItem[]> {
		if (!element) {
			const repositories = listGitRepositories();
			if (repositories.length === 0) {
				return [new RemoteEmptyTreeItem()];
			}

			return repositories.map(repository => new RepositoryRootTreeItem(repository));
		}

		if (element instanceof RepositoryRootTreeItem) {
			const remotes = await getGitRemotes(element.repository.workspacePath);
			if (remotes.length === 0) {
				return [new RemoteEmptyTreeItem(element.repository)];
			}

			return remotes.map(remote => new RemoteTreeItem(element.repository, remote));
		}

		return [];
	}

	getParent(element: ScmRemoteTreeItem): ScmRemoteTreeItem | null {
		if (element instanceof RemoteTreeItem || element instanceof RemoteEmptyTreeItem) {
			return element.repository ? new RepositoryRootTreeItem(element.repository) : null;
		}

		return null;
	}
}

function updateScmRemoteViewMetadata(): void {
	if (!scmRemoteTreeView) {
		return;
	}

	const repositories = listGitRepositories();
	scmRemoteTreeView.title = REMOTE_REPOSITORY_MANAGEMENT_PANEL_TITLE;
	scmRemoteTreeView.description = repositories.length > 0 ? `${repositories.length} 个仓库` : '无仓库';
	scmRemoteTreeView.message = repositories.length === 0 ? '当前工作区未检测到 Git 仓库。' : undefined;
	scmRemoteTreeView.badge = undefined;
}

async function focusRemoteRepositoryView(): Promise<void> {
	await vscode.commands.executeCommand('workbench.view.scm');
	scmRemoteDataProvider?.refresh();

	try {
		await vscode.commands.executeCommand(`${REMOTE_REPOSITORY_MANAGEMENT_VIEW_ID}.focus`);
	} catch {
		// 部分情况下 focus 命令不存在，打开 SCM 视图即可。
	}
}

async function resolveRepositorySummary(workspacePath: string): Promise<GitRepositorySummary> {
	const repository = listGitRepositories().find(item => item.workspacePath === workspacePath);
	if (repository) {
		return repository;
	}

	const { workspacePath: resolvedWorkspacePath } = await resolveGitRepository({ rootUri: vscode.Uri.file(workspacePath) });
	return {
		rootUri: vscode.Uri.file(resolvedWorkspacePath),
		workspacePath: resolvedWorkspacePath,
		label: resolvedWorkspacePath.split(/[/\\]/).pop() || resolvedWorkspacePath,
		description: resolvedWorkspacePath
	};
	}

async function resolveWorkspacePath(item?: ScmRemoteTreeItem): Promise<string> {
	if (item instanceof RepositoryRootTreeItem) {
		return item.repository.workspacePath;
	}

	if (item instanceof RemoteTreeItem) {
		return item.repository.workspacePath;
	}

	if (item instanceof RemoteEmptyTreeItem && item.repository) {
		return item.repository.workspacePath;
	}

	const { workspacePath } = await resolveGitRepository();
	return workspacePath;
}

async function pickRemote(workspacePath: string): Promise<GitRemoteEntry | undefined> {
	const remotes = await getGitRemotes(workspacePath);
	if (remotes.length === 0) {
		vscode.window.showInformationMessage('当前仓库还没有配置远程仓库。');
		return undefined;
	}

	const selected = await vscode.window.showQuickPick(remotes.map(remote => ({
		label: remote.name,
		detail: remote.fetchUrl || remote.pushUrl || '无 URL',
		description: remote.fetchUrl && remote.pushUrl && remote.fetchUrl !== remote.pushUrl
			? `fetch: ${remote.fetchUrl} / push: ${remote.pushUrl}`
			: undefined,
		remote
	})), {
		placeHolder: '选择远程仓库'
	});

	return selected?.remote;
}

async function resolveRemoteTarget(item?: ScmRemoteTreeItem): Promise<{ repository: GitRepositorySummary; remote: GitRemoteEntry; }> {
	if (item instanceof RemoteTreeItem) {
		return {
			repository: item.repository,
			remote: item.remote
		};
	}

	const workspacePath = await resolveWorkspacePath(item);
	const remote = await pickRemote(workspacePath);
	if (!remote) {
		throw new Error('未选择远程仓库');
	}

	return {
		repository: await resolveRepositorySummary(workspacePath),
		remote
	};
}

async function promptForRemoteName(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入远程仓库名称',
		placeHolder: '例如: origin / upstream',
		value: defaultValue,
		validateInput: value => value.trim() ? undefined : '远程仓库名称不能为空'
	});
}

async function promptForRemoteUrl(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入远程仓库地址',
		placeHolder: '例如: https://github.com/user/repo.git',
		value: defaultValue,
		validateInput: value => value.trim() ? undefined : '远程仓库地址不能为空'
	});
}

async function handleAddRemote(item?: ScmRemoteTreeItem): Promise<void> {
	const workspacePath = await resolveWorkspacePath(item);
	const name = await promptForRemoteName('origin');
	if (name === undefined) {
		return;
	}

	const url = await promptForRemoteUrl('');
	if (url === undefined) {
		return;
	}

	await addGitRemote(workspacePath, name.trim(), url.trim());
	scmRemoteDataProvider?.refresh();
	vscode.window.showInformationMessage(`已添加远程仓库: ${name.trim()}`);
}

async function handleEditRemote(item?: ScmRemoteTreeItem): Promise<void> {
	const { repository, remote } = await resolveRemoteTarget(item);
	const nextName = await promptForRemoteName(remote.name);
	if (nextName === undefined) {
		return;
	}

	const currentUrl = remote.fetchUrl || remote.pushUrl || '';
	const nextUrl = await promptForRemoteUrl(currentUrl);
	if (nextUrl === undefined) {
		return;
	}

	const trimmedName = nextName.trim();
	const trimmedUrl = nextUrl.trim();
	if (trimmedName !== remote.name) {
		await renameGitRemote(repository.workspacePath, remote.name, trimmedName);
	}

	if (trimmedUrl !== currentUrl || (remote.fetchUrl && remote.pushUrl && remote.fetchUrl !== remote.pushUrl)) {
		await setGitRemoteUrl(repository.workspacePath, trimmedName, trimmedUrl);
	}

	scmRemoteDataProvider?.refresh();
	vscode.window.showInformationMessage(`已更新远程仓库: ${trimmedName}`);
}

async function handleDeleteRemote(item?: ScmRemoteTreeItem): Promise<void> {
	const { repository, remote } = await resolveRemoteTarget(item);
	const selection = await vscode.window.showWarningMessage(
		`确认删除远程仓库 ${remote.name} 吗？`,
		{ modal: true },
		'删除'
	);
	if (selection !== '删除') {
		return;
	}

	await deleteGitRemote(repository.workspacePath, remote.name);
	scmRemoteDataProvider?.refresh();
	vscode.window.showInformationMessage(`已删除远程仓库: ${remote.name}`);
}

async function handleFetchRemote(item?: ScmRemoteTreeItem): Promise<void> {
	const { repository, remote } = await resolveRemoteTarget(item);
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `正在拉取 ${remote.name}...`,
		cancellable: false
	}, async () => {
		await fetchGitRemote(repository.workspacePath, remote.name);
	});

	vscode.window.showInformationMessage(`拉取完成: ${remote.name}`);
}

async function handlePushRemote(item?: ScmRemoteTreeItem): Promise<void> {
	const { repository, remote } = await resolveRemoteTarget(item);
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `正在推送到 ${remote.name}...`,
		cancellable: false
	}, async () => {
		await pushGitRemote(repository.workspacePath, remote.name);
	});

	vscode.window.showInformationMessage(`推送完成: ${remote.name}`);
}

async function handleCopyRemoteUrl(item?: ScmRemoteTreeItem): Promise<void> {
	const { remote } = await resolveRemoteTarget(item);
	const url = remote.fetchUrl || remote.pushUrl;
	if (!url) {
		throw new Error('当前远程仓库没有可复制的 URL');
	}

	await vscode.env.clipboard.writeText(url);
	vscode.window.showInformationMessage(`已复制远程仓库地址: ${remote.name}`);
}

export function registerScmRemoteRepositoryView(context: vscode.ExtensionContext): void {
	scmRemoteDataProvider = new ScmRemoteTreeDataProvider();
	scmRemoteTreeView = vscode.window.createTreeView(REMOTE_REPOSITORY_MANAGEMENT_VIEW_ID, {
		treeDataProvider: scmRemoteDataProvider,
		showCollapseAll: true,
		canSelectMany: false
	});
	updateScmRemoteViewMetadata();

	context.subscriptions.push(scmRemoteTreeView);
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
		scmRemoteDataProvider?.refresh();
	}));
	context.subscriptions.push(scmRemoteTreeView.onDidChangeVisibility(() => {
		if (scmRemoteTreeView?.visible) {
			scmRemoteDataProvider?.refresh();
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(OPEN_REMOTE_REPOSITORY_MANAGEMENT_COMMAND, async () => {
		await focusRemoteRepositoryView();
	}));
	context.subscriptions.push(vscode.commands.registerCommand(SHOW_REMOTE_REPOSITORY_COMMAND, async () => {
		await focusRemoteRepositoryView();
	}));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_REMOTE_REPOSITORY_COMMAND, async (item?: ScmRemoteTreeItem) => {
		try {
			await handleAddRemote(item);
		} catch (error) {
			logError('新增远程仓库失败:', error);
			vscode.window.showErrorMessage(`新增远程仓库失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(EDIT_REMOTE_REPOSITORY_COMMAND, async (item?: ScmRemoteTreeItem) => {
		try {
			await handleEditRemote(item);
		} catch (error) {
			logError('编辑远程仓库失败:', error);
			vscode.window.showErrorMessage(`编辑远程仓库失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(DELETE_REMOTE_REPOSITORY_COMMAND, async (item?: ScmRemoteTreeItem) => {
		try {
			await handleDeleteRemote(item);
		} catch (error) {
			logError('删除远程仓库失败:', error);
			vscode.window.showErrorMessage(`删除远程仓库失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(FETCH_REMOTE_REPOSITORY_COMMAND, async (item?: ScmRemoteTreeItem) => {
		try {
			await handleFetchRemote(item);
		} catch (error) {
			logError('拉取远程仓库失败:', error);
			vscode.window.showErrorMessage(`拉取远程仓库失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(PUSH_TO_REMOTE_REPOSITORY_COMMAND, async (item?: ScmRemoteTreeItem) => {
		try {
			await handlePushRemote(item);
		} catch (error) {
			logError('推送远程仓库失败:', error);
			vscode.window.showErrorMessage(`推送远程仓库失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(COPY_REMOTE_REPOSITORY_URL_COMMAND, async (item?: ScmRemoteTreeItem) => {
		try {
			await handleCopyRemoteUrl(item);
		} catch (error) {
			logError('复制远程仓库地址失败:', error);
			vscode.window.showErrorMessage(`复制远程仓库地址失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(REFRESH_REMOTE_REPOSITORIES_COMMAND, () => {
		scmRemoteDataProvider?.refresh();
	}));
}