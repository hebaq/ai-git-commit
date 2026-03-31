import * as vscode from 'vscode';

import { appendOutputLine, logError, showOutputChannel } from '../gitCommit/output';
import {
	ADD_WORKSPACE_DEPLOYMENT_TARGET_COMMAND,
	ADD_DEPLOYMENT_SERVER_COMMAND,
	DELETE_WORKSPACE_DEPLOYMENT_TARGET_COMMAND,
	DELETE_DEPLOYMENT_SERVER_COMMAND,
	DEPLOYMENT_DEFAULT_TIMEOUT_SECONDS,
	DEPLOYMENT_GLOBAL_SERVER_ITEM_CONTEXT,
	DEPLOYMENT_GLOBAL_ROOT_CONTEXT,
	EDIT_WORKSPACE_DEPLOYMENT_TARGET_COMMAND,
	EXPORT_DEPLOYMENT_SERVERS_COMMAND,
	IMPORT_DEPLOYMENT_SERVERS_COMMAND,
	DEPLOYMENT_PANEL_TITLE,
	OPEN_DEPLOYMENT_SERVER_TERMINAL_COMMAND,
	DEPLOYMENT_SERVER_GROUP_CONTEXT,
	DEPLOYMENT_SERVER_ITEM_CONTEXT,
	DEPLOYMENT_VIEW_CONTAINER_ID,
	DEPLOYMENT_VIEW_ID,
	DEPLOYMENT_WORKSPACE_SERVER_ITEM_CONTEXT,
	DEPLOYMENT_WORKSPACE_TARGET_EMPTY_ITEM_CONTEXT,
	DEPLOYMENT_WORKSPACE_TARGET_ITEM_CONTEXT,
	DEPLOYMENT_WORKSPACE_ROOT_CONTEXT,
	EDIT_DEPLOYMENT_SERVER_COMMAND,
	OPEN_DEPLOYMENT_MANAGEMENT_COMMAND,
	REFRESH_DEPLOYMENT_SERVERS_COMMAND,
	RUN_DEFAULT_DEPLOYMENT_ACTION_COMMAND,
	RUN_DEPLOYMENT_ACTION_COMMAND,
	TEST_DEPLOYMENT_SERVER_COMMAND,
	UPLOAD_EXPLORER_RESOURCES_COMMAND,
	UPLOAD_DEPLOYMENT_FILES_COMMAND
} from './constants';
import {
	getAllDeploymentServers,
	getDeploymentServerById,
	getDeploymentServerGroups,
	getDeploymentServersState,
	getWorkspaceDeploymentTargetById,
	getWorkspaceDeploymentTargets,
	hasWorkspaceScope,
	resolveWorkspaceDeploymentTarget,
	updateWorkspaceDeploymentTargets,
	updateDeploymentServers
} from './config';
import { exportDeploymentConfiguration, importDeploymentConfiguration } from './importExport';
import {
	deleteDeploymentSecrets,
	getDeploymentPasswordDraft,
	getDeploymentPrivateKeyDraft,
	getDeploymentSecretEnvDrafts,
	initializeDeploymentSecretStorage,
	saveDeploymentPasswordDraft,
	saveDeploymentPrivateKeyDraft,
	saveDeploymentSecretEnvDrafts
} from './secretStorage';
import { runDeploymentAction, testDeploymentConnection, uploadFilesToDeploymentServer } from './ssh';
import { openDeploymentServerTerminal, registerDeploymentTerminalCleanup } from './terminal';
import type {
	DeploymentAction,
	DeploymentAuthType,
	DeploymentPasswordDraft,
	DeploymentPrivateKeyDraft,
	DeploymentScope,
	DeploymentSecretEnvDraft,
	DeploymentServerProfile,
	DeploymentWorkspaceTarget,
	ScopedDeploymentServer
} from './types';

const DEPLOYMENT_GROUP_ROOT_IDS: Record<DeploymentScope, string> = {
	global: 'deployment-global-root',
	workspace: 'deployment-workspace-root'
};

let deploymentManagementDataProvider: DeploymentManagementTreeDataProvider | undefined;
let deploymentManagementTreeView: vscode.TreeView<DeploymentManagementTreeItem> | undefined;

type DeploymentManagementTreeItem = DeploymentGroupRootTreeItem | DeploymentWorkspaceTargetTreeItem | DeploymentWorkspaceTargetEmptyTreeItem | DeploymentServerGroupTreeItem | DeploymentServerTreeItem;
type ActionEditorResult = DeploymentAction | 'delete' | undefined;
type SecretEditorResult = DeploymentSecretEnvDraft | 'delete' | undefined;
type ServerEditorAction = 'cancel' | 'name' | 'groupPath' | 'note' | 'host' | 'port' | 'username' | 'authType' | 'password' | 'privateKey' | 'secrets' | 'test' | 'save';
type ActionEditorAction = 'cancel' | 'name' | 'command' | 'confirm' | 'timeout' | 'delete' | 'save';
type SecretEnvEditorAction = 'cancel' | 'key' | 'value' | 'delete' | 'save';
type WorkspaceDeploymentTargetEditorAction = 'cancel' | 'name' | 'server' | 'remoteRoot' | 'actions' | 'defaultAction' | 'delete' | 'save';

interface ServerEditorResult {
	profile: DeploymentServerProfile;
	secretDrafts: DeploymentSecretEnvDraft[];
	passwordDraft: DeploymentPasswordDraft;
	privateKeyDraft: DeploymentPrivateKeyDraft;
	previousSecretKeys: string[];
	scope: DeploymentScope;
}

interface DeploymentQuickPickItem<TAction extends string> extends vscode.QuickPickItem {
	action: TAction;
}

interface ActionListQuickPickItem extends vscode.QuickPickItem {
	action: 'back' | 'add' | 'edit';
	actionId?: string;
}

interface SecretListQuickPickItem extends vscode.QuickPickItem {
	action: 'back' | 'add' | 'edit';
	secretKey?: string;
}

class DeploymentGroupRootTreeItem extends vscode.TreeItem {
	constructor(public readonly scope: DeploymentScope, serverCount: number) {
		super(scope === 'global' ? '全局服务器' : '当前工作区', vscode.TreeItemCollapsibleState.Expanded);
		this.id = DEPLOYMENT_GROUP_ROOT_IDS[scope];
		this.description = `${serverCount} 台`;
		this.tooltip = `${this.label} (${serverCount} 台)`;
		this.iconPath = new vscode.ThemeIcon(scope === 'global' ? 'globe' : 'repo');
		this.contextValue = scope === 'global' ? DEPLOYMENT_GLOBAL_ROOT_CONTEXT : DEPLOYMENT_WORKSPACE_ROOT_CONTEXT;
	}
}

class DeploymentServerTreeItem extends vscode.TreeItem {
	constructor(public readonly server: ScopedDeploymentServer) {
		super(server.name, vscode.TreeItemCollapsibleState.None);
		this.id = server.id;
		this.description = `${server.username}@${server.host}:${server.port}`;
		this.tooltip = new vscode.MarkdownString([
			`**${server.name}**`,
			`- 范围: ${getScopeLabel(server.scope)}`,
			`- 分组: ${server.groupPath || '未分组'}`,
			`- 备注: ${server.note || '无'}`,
			`- SSH: ${server.username}@${server.host}:${server.port}`,
			`- 认证方式: ${getAuthTypeLabel(server.authType)}`,
			'- 说明: 部署动作和远程目录已迁到“工作区部署目标”中维护',
			`- 敏感环境变量: ${server.secretEnvKeys.length} 个`
		].join('\n'));
		this.contextValue = server.scope === 'global'
			? DEPLOYMENT_GLOBAL_SERVER_ITEM_CONTEXT
			: DEPLOYMENT_WORKSPACE_SERVER_ITEM_CONTEXT;
		this.iconPath = new vscode.ThemeIcon(server.scope === 'global' ? 'server-environment' : 'server-process');
	}
}

class DeploymentServerGroupTreeItem extends vscode.TreeItem {
	constructor(public readonly scope: DeploymentScope, public readonly groupPath: string, serverCount: number) {
		super(groupPath.split('/').pop() || groupPath, vscode.TreeItemCollapsibleState.Expanded);
		this.id = `deployment-group-${scope}-${groupPath}`;
		this.description = `${serverCount} 台`;
		this.tooltip = `${groupPath} (${serverCount} 台)`;
		this.iconPath = new vscode.ThemeIcon('folder');
		this.contextValue = DEPLOYMENT_SERVER_GROUP_CONTEXT;
	}
	}

class DeploymentWorkspaceTargetTreeItem extends vscode.TreeItem {
	constructor(public readonly target: DeploymentWorkspaceTarget) {
		const resolvedTarget = resolveWorkspaceDeploymentTarget(target.id);
		super(target.name, vscode.TreeItemCollapsibleState.None);
		this.id = `deployment-workspace-target-${target.id}`;
		this.description = resolvedTarget
			? `${resolvedTarget.server.name} / ${resolvedTarget.defaultAction?.name || '未设默认动作'}`
			: '绑定服务器无效';
		this.tooltip = new vscode.MarkdownString([
			`**${target.name}**`,
			resolvedTarget
				? `- 服务器: ${resolvedTarget.server.name}`
				: '- 当前绑定的服务器不存在或不可用',
			`- 远程目录: ${target.remoteRoot || '未设置'}`,
			`- 动作数量: ${target.actions.length} 个`,
			`- 默认动作: ${resolvedTarget?.defaultAction?.name || '未设置'}`,
			'- 每个部署目标都可以绑定不同服务器，例如测试/正式环境'
		].join('\n'));
		this.iconPath = new vscode.ThemeIcon(resolvedTarget ? 'target' : 'warning');
		this.contextValue = DEPLOYMENT_WORKSPACE_TARGET_ITEM_CONTEXT;
		this.command = resolvedTarget?.defaultAction
			? {
				command: RUN_DEFAULT_DEPLOYMENT_ACTION_COMMAND,
				title: '执行默认部署',
				arguments: [this]
			}
			: {
				command: EDIT_WORKSPACE_DEPLOYMENT_TARGET_COMMAND,
				title: '编辑部署目标',
				arguments: [this]
			};
	}
}

class DeploymentWorkspaceTargetEmptyTreeItem extends vscode.TreeItem {
	constructor() {
		super('还没有部署目标', vscode.TreeItemCollapsibleState.None);
		this.id = 'deployment-workspace-target-empty';
		this.description = '点击新增';
		this.tooltip = '当前工作区还没有部署目标，可新增测试、预发、正式等多个目标';
		this.iconPath = new vscode.ThemeIcon('circle-large-outline');
		this.contextValue = DEPLOYMENT_WORKSPACE_TARGET_EMPTY_ITEM_CONTEXT;
		this.command = {
			command: ADD_WORKSPACE_DEPLOYMENT_TARGET_COMMAND,
			title: '新增部署目标'
		};
	}
}

class DeploymentManagementTreeDataProvider implements vscode.TreeDataProvider<DeploymentManagementTreeItem> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<DeploymentManagementTreeItem | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
		updateDeploymentManagementViewMetadata();
	}

	getTreeItem(element: DeploymentManagementTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: DeploymentManagementTreeItem): DeploymentManagementTreeItem[] {
		const groups = getDeploymentServerGroups();

		if (!element) {
			return groups.map(group => new DeploymentGroupRootTreeItem(group.scope, group.servers.length));
		}

		if (element instanceof DeploymentGroupRootTreeItem) {
			return element.scope === 'workspace'
				? [...getWorkspaceDeploymentTargetTreeItems(), ...getDeploymentTreeChildren(element.scope)]
				: getDeploymentTreeChildren(element.scope);
		}

		if (element instanceof DeploymentServerGroupTreeItem) {
			return getDeploymentTreeChildren(element.scope, element.groupPath);
		}

		return [];
	}

	getParent(element: DeploymentManagementTreeItem): DeploymentManagementTreeItem | null {
		if (element instanceof DeploymentWorkspaceTargetTreeItem || element instanceof DeploymentWorkspaceTargetEmptyTreeItem) {
			const group = getDeploymentServerGroups().find(item => item.scope === 'workspace');
			return new DeploymentGroupRootTreeItem('workspace', group?.servers.length || 0);
		}

		if (element instanceof DeploymentServerTreeItem) {
			if (element.server.groupPath) {
				return createParentGroupTreeItem(element.server.scope, element.server.groupPath);
			}

			const group = getDeploymentServerGroups().find(item => item.scope === element.server.scope);
			return new DeploymentGroupRootTreeItem(element.server.scope, group?.servers.length || 0);
		}

		if (element instanceof DeploymentServerGroupTreeItem) {
			const parentGroupPath = getParentGroupPath(element.groupPath);
			if (parentGroupPath) {
				return createParentGroupTreeItem(element.scope, parentGroupPath);
			}

			const group = getDeploymentServerGroups().find(item => item.scope === element.scope);
			return new DeploymentGroupRootTreeItem(element.scope, group?.servers.length || 0);
		}

		return null;
	}

	getItemById(serverId: string): DeploymentServerTreeItem | undefined {
		const server = getDeploymentServerById(serverId);
		return server ? createDeploymentServerTreeItem(server) : undefined;
	}
}

function createDeploymentServerTreeItem(server: ScopedDeploymentServer): DeploymentServerTreeItem {
	return new DeploymentServerTreeItem(server);
}

function getWorkspaceDeploymentTargetTreeItems(): Array<DeploymentWorkspaceTargetTreeItem | DeploymentWorkspaceTargetEmptyTreeItem> {
	const targets = getWorkspaceDeploymentTargets()
		.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

	if (targets.length === 0) {
		return [new DeploymentWorkspaceTargetEmptyTreeItem()];
	}

	return targets.map(target => new DeploymentWorkspaceTargetTreeItem(target));
}

function splitGroupPath(groupPath?: string): string[] {
	return groupPath
		? groupPath.split('/').map(segment => segment.trim()).filter(Boolean)
		: [];
	}

function joinGroupPath(segments: string[]): string | undefined {
	const normalized = segments.map(segment => segment.trim()).filter(Boolean).join('/');
	return normalized || undefined;
	}

function isGroupPathPrefix(groupPath: string | undefined, parentGroupPath?: string): boolean {
	if (!parentGroupPath) {
		return true;
	}

	const groupSegments = splitGroupPath(groupPath);
	const parentSegments = splitGroupPath(parentGroupPath);
	if (parentSegments.length > groupSegments.length) {
		return false;
	}

	return parentSegments.every((segment, index) => segment === groupSegments[index]);
	}

function getParentGroupPath(groupPath: string): string | undefined {
	const segments = splitGroupPath(groupPath);
	return joinGroupPath(segments.slice(0, -1));
	}

function getScopedServers(scope: DeploymentScope): ScopedDeploymentServer[] {
	const group = getDeploymentServerGroups().find(item => item.scope === scope);
	return (group?.servers || []).map(server => ({ ...server, scope }));
	}

function createParentGroupTreeItem(scope: DeploymentScope, groupPath: string): DeploymentServerGroupTreeItem {
	const scopedServers = getScopedServers(scope);
	const count = scopedServers.filter(server => isGroupPathPrefix(server.groupPath, groupPath)).length;
	return new DeploymentServerGroupTreeItem(scope, groupPath, count);
	}

function getDeploymentTreeChildren(scope: DeploymentScope, parentGroupPath?: string): DeploymentManagementTreeItem[] {
	const scopedServers = getScopedServers(scope);
	const childGroupCounts = new Map<string, number>();
	const directServers: ScopedDeploymentServer[] = [];
	const parentSegments = splitGroupPath(parentGroupPath);

	for (const server of scopedServers) {
		if (!isGroupPathPrefix(server.groupPath, parentGroupPath)) {
			continue;
		}

		const serverSegments = splitGroupPath(server.groupPath);
		if (serverSegments.length === parentSegments.length) {
			directServers.push(server);
			continue;
		}

		const childGroupPath = joinGroupPath(serverSegments.slice(0, parentSegments.length + 1));
		if (!childGroupPath) {
			continue;
		}

		childGroupCounts.set(childGroupPath, (childGroupCounts.get(childGroupPath) || 0) + 1);
	}

	const groupItems = [...childGroupCounts.entries()]
		.sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
		.map(([groupPath, count]) => new DeploymentServerGroupTreeItem(scope, groupPath, count));
	const serverItems = directServers
		.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
		.map(server => createDeploymentServerTreeItem(server));

	return [...groupItems, ...serverItems];
	}

function getScopeLabel(scope: DeploymentScope): string {
	return scope === 'global' ? '全局' : '工作区';
}

function createServerId(): string {
	return `deploy-server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createActionId(): string {
	return `deploy-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createWorkspaceTargetId(): string {
	return `deploy-target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getAuthTypeLabel(authType: DeploymentAuthType): string {
	if (authType === 'password') {
		return '密码登录';
	}

	if (authType === 'privateKey') {
		return '私钥登录';
	}

	return '系统 SSH';
}

function cloneAction(action: DeploymentAction): DeploymentAction {
	return { ...action };
}

function cloneSecretDraft(secretDraft: DeploymentSecretEnvDraft): DeploymentSecretEnvDraft {
	return { ...secretDraft };
}

function clonePasswordDraft(passwordDraft: DeploymentPasswordDraft): DeploymentPasswordDraft {
	return { ...passwordDraft };
}

function clonePrivateKeyDraft(privateKeyDraft: DeploymentPrivateKeyDraft): DeploymentPrivateKeyDraft {
	return { ...privateKeyDraft };
	}

function updateDeploymentManagementViewMetadata(): void {
	if (!deploymentManagementTreeView) {
		return;
	}

	const allServers = getAllDeploymentServers();
	const workspaceTargets = getWorkspaceDeploymentTargets();
	deploymentManagementTreeView.title = DEPLOYMENT_PANEL_TITLE;
	deploymentManagementTreeView.description = workspaceTargets.length > 0
		? `${workspaceTargets.length} 个部署目标`
		: allServers.length > 0 ? `${allServers.length} 台服务器` : '未配置';
	deploymentManagementTreeView.badge = undefined;
	deploymentManagementTreeView.message = allServers.length === 0
		? '还没有服务器。点击标题栏的“新增服务器”开始。'
		: workspaceTargets.length === 0 ? '当前工作区还没有部署目标。点击标题栏的“新增部署目标”开始。' : undefined;
	}

async function promptForScope(defaultScope?: DeploymentScope): Promise<DeploymentScope | undefined> {
	const items: Array<vscode.QuickPickItem & { scope: DeploymentScope }> = [
		{ label: '全局服务器', description: '所有工作区共享', scope: 'global' as const, picked: defaultScope === 'global' },
		{ label: '工作区服务器', description: '仅当前工作区可见', scope: 'workspace' as const, picked: defaultScope === 'workspace' }
	].filter(item => item.scope !== 'workspace' || hasWorkspaceScope());

	const selected = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder: '选择服务器保存范围'
	});

	return selected?.scope;
	}

async function promptForNonEmptyInput(prompt: string, placeHolder: string, value: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt,
		placeHolder,
		value,
		validateInput: input => input.trim() ? undefined : '不能为空'
	});
	}

async function promptForTargetName(defaultValue: string): Promise<string | undefined> {
	return promptForNonEmptyInput('输入部署目标名称', '例如：测试环境 / 预发环境 / 正式环境', defaultValue);
}

async function promptForUploadDirectory(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入远程上传目录',
		placeHolder: '例如：/var/www/project/uploads',
		value: defaultValue,
		validateInput: input => input.trim() ? undefined : '远程目录不能为空'
	});
}

function joinRemoteDirectory(baseDirectory: string, childPath: string): string {
	const normalizedBase = baseDirectory.replace(/\\/g, '/').replace(/\/$/, '');
	const normalizedChild = childPath
		.split(/[\\/]+/)
		.map(segment => segment.trim())
		.filter(Boolean)
		.join('/');

	return normalizedChild ? `${normalizedBase}/${normalizedChild}` : normalizedBase;
}

async function promptForTargetUploadDirectory(targetName: string, baseDirectory: string): Promise<string | undefined> {
	const normalizedBaseDirectory = baseDirectory.trim();
	if (!normalizedBaseDirectory) {
		return promptForUploadDirectory('');
	}

	const selected = await vscode.window.showQuickPick([
		{
			label: '上传到目标默认目录',
			description: normalizedBaseDirectory,
			mode: 'default' as const
		},
		{
			label: '上传到目标子目录',
			description: `在 ${targetName} 的默认目录下指定子目录`,
			mode: 'subdir' as const
		}
	], {
		ignoreFocusOut: true,
		placeHolder: `选择 ${targetName} 的上传目录`
	});

	if (!selected) {
		return undefined;
	}

	if (selected.mode === 'default') {
		return normalizedBaseDirectory;
	}

	const subdirectory = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: `输入 ${targetName} 默认目录下的子目录`,
		placeHolder: '例如：static/images 或 releases/2026-03',
		validateInput: input => input.trim() ? undefined : '子目录不能为空'
	});
	if (subdirectory === undefined) {
		return undefined;
	}

	return joinRemoteDirectory(normalizedBaseDirectory, subdirectory);
}

async function promptForName(defaultValue: string): Promise<string | undefined> {
	return promptForNonEmptyInput('输入服务器名称', '例如：开发环境 / 预发环境', defaultValue);
}

async function promptForGroupPath(defaultValue: string): Promise<string | undefined> {
	const value = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入服务器分组路径，可留空',
		placeHolder: '例如：外包客户/文件查重系统',
		value: defaultValue
	});

	return value !== undefined
		? value.split(/[\\/]+/).map(segment => segment.trim()).filter(Boolean).join('/')
		: undefined;
	}

async function promptForNote(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入服务器备注，可留空',
		placeHolder: '例如：部署用途、客户信息、注意事项',
		value: defaultValue
	});
	}

async function promptForHost(defaultValue: string): Promise<string | undefined> {
	return promptForNonEmptyInput('输入服务器地址', '例如：192.168.1.10 或 example.com', defaultValue);
}

async function promptForUsername(defaultValue: string): Promise<string | undefined> {
	return promptForNonEmptyInput('输入 SSH 用户名', '例如：root / deploy', defaultValue);
}

async function promptForAuthType(defaultValue: DeploymentAuthType): Promise<DeploymentAuthType | undefined> {
	const selected = await vscode.window.showQuickPick([
		{ label: '系统 SSH', description: '使用本机 ssh / ssh-agent / 密钥配置', authType: 'system' as const, picked: defaultValue === 'system' },
		{ label: '密码登录', description: '将密码加密保存到 SecretStorage，并通过 ssh2 连接', authType: 'password' as const, picked: defaultValue === 'password' }
		,
		{ label: '私钥登录', description: '将私钥加密保存到 SecretStorage，并通过 ssh2 连接', authType: 'privateKey' as const, picked: defaultValue === 'privateKey' }
	], {
		ignoreFocusOut: true,
		placeHolder: '选择 SSH 认证方式'
	});

	return selected?.authType;
	}

async function promptForPassword(hasStoredValue: boolean): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		password: true,
		prompt: hasStoredValue ? '输入 SSH 密码，留空则保留当前密码' : '输入 SSH 密码',
		placeHolder: hasStoredValue ? '留空则保持不变' : '用于密码登录'
	});
	}

async function promptForPrivateKey(hasStoredValue: boolean): Promise<string | null | undefined> {
	const selected = await vscode.window.showQuickPick([
		{ label: '从文件导入私钥', description: '选择 PEM / KEY 文件', action: 'import' as const },
		...(hasStoredValue ? [{ label: '清除已保存私钥', description: '删除当前加密保存的私钥', action: 'clear' as const }] : [])
	], {
		ignoreFocusOut: true,
		placeHolder: '管理 SSH 私钥'
	});

	if (!selected) {
		return undefined;
	}

	if (selected.action === 'clear') {
		return null;
	}

	const fileUris = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		openLabel: '选择私钥文件'
	});
	if (!fileUris || fileUris.length === 0) {
		return undefined;
	}

	const fileBuffer = await vscode.workspace.fs.readFile(fileUris[0]);
	return Buffer.from(fileBuffer).toString('utf8');
	}

async function promptForPort(defaultValue: number): Promise<number | undefined> {
	const value = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入 SSH 端口',
		placeHolder: '默认 22',
		value: String(defaultValue || 22),
		validateInput: input => {
			const parsed = Number(input.trim());
			if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
				return '请输入 1-65535 之间的整数端口';
			}

			return undefined;
		}
	});

	return value !== undefined ? Number(value.trim()) : undefined;
	}

async function promptForRemoteRoot(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入远程项目目录，可留空',
		placeHolder: '例如：/var/www/project',
		value: defaultValue
	});
	}

async function promptForActionName(defaultValue: string): Promise<string | undefined> {
	return promptForNonEmptyInput('输入动作名称', '例如：部署 / 拉代码 / 重启服务', defaultValue);
	}

async function promptForActionCommand(defaultValue: string): Promise<string | undefined> {
	return promptForNonEmptyInput('输入远程执行命令', '例如：git pull && pnpm install && pnpm build', defaultValue);
	}

async function promptForTimeoutSeconds(defaultValue: number): Promise<number | undefined> {
	const value = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入动作超时时间（秒）',
		placeHolder: `默认 ${DEPLOYMENT_DEFAULT_TIMEOUT_SECONDS}`,
		value: String(defaultValue || DEPLOYMENT_DEFAULT_TIMEOUT_SECONDS),
		validateInput: input => {
			const parsed = Number(input.trim());
			if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 86400) {
				return '请输入 1-86400 之间的整数';
			}

			return undefined;
		}
	});

	return value !== undefined ? Number(value.trim()) : undefined;
	}

function validateSecretEnvKey(key: string): string | undefined {
	if (!key.trim()) {
		return '环境变量名不能为空';
	}

	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key.trim())) {
		return '环境变量名只能包含字母、数字和下划线，且不能以数字开头';
	}

	return undefined;
	}

async function promptForSecretEnvKey(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入敏感环境变量名',
		placeHolder: '例如：DEPLOY_TOKEN',
		value: defaultValue,
		validateInput: validateSecretEnvKey
	});
	}

async function promptForSecretEnvValue(defaultValue: string, keepCurrentValue: boolean): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		password: true,
		prompt: keepCurrentValue ? '输入环境变量值，留空则保留当前值' : '输入环境变量值',
		placeHolder: keepCurrentValue ? '留空则保持不变' : '例如：secret-token',
		value: defaultValue
	});
	}

function buildActionEditorItems(action: DeploymentAction, isNewAction: boolean): Array<DeploymentQuickPickItem<ActionEditorAction>> {
	return [
		{ label: '$(arrow-left) 返回', description: isNewAction ? '取消新增动作' : '不保存返回', action: 'cancel' },
		{ label: '$(tag) 动作名称', description: action.name || '未设置', action: 'name' },
		{ label: '$(terminal) 执行命令', description: action.command || '未设置', action: 'command' },
		{ label: '$(question) 执行前确认', description: action.confirm ? '已开启' : '未开启', action: 'confirm' },
		{ label: '$(clock) 超时时间', description: `${action.timeoutSeconds} 秒`, action: 'timeout' },
		{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'cancel' },
		...(!isNewAction ? [{ label: '$(trash) 删除动作', description: '删除当前动作', action: 'delete' as const }] : []),
		{ label: '$(check) 保存动作', description: '保存当前修改', action: 'save' }
	];
	}

function validateActionDraft(action: DeploymentAction): string | undefined {
	if (!action.name.trim()) {
		return '动作名称不能为空';
	}

	if (!action.command.trim()) {
		return '执行命令不能为空';
	}

	if (!Number.isInteger(action.timeoutSeconds) || action.timeoutSeconds <= 0) {
		return '超时时间必须是正整数';
	}

	return undefined;
	}

async function editActionDraft(initialAction: DeploymentAction, isNewAction: boolean): Promise<ActionEditorResult> {
	const draft = cloneAction(initialAction);

	while (true) {
		const selected = await vscode.window.showQuickPick(buildActionEditorItems(draft, isNewAction), {
			ignoreFocusOut: true,
			placeHolder: '编辑部署动作'
		});

		if (!selected || selected.action === 'cancel') {
			return undefined;
		}

		switch (selected.action) {
			case 'name': {
				const name = await promptForActionName(draft.name);
				if (name !== undefined) {
					draft.name = name.trim();
				}
				break;
			}
			case 'command': {
				const command = await promptForActionCommand(draft.command);
				if (command !== undefined) {
					draft.command = command.trim();
				}
				break;
			}
			case 'confirm':
				draft.confirm = !draft.confirm;
				break;
			case 'timeout': {
				const timeoutSeconds = await promptForTimeoutSeconds(draft.timeoutSeconds);
				if (timeoutSeconds !== undefined) {
					draft.timeoutSeconds = timeoutSeconds;
				}
				break;
			}
			case 'delete': {
				const confirmed = await vscode.window.showWarningMessage(`确定删除部署动作“${draft.name}”吗？`, { modal: true }, '删除');
				return confirmed === '删除' ? 'delete' : undefined;
			}
			case 'save': {
				const validationError = validateActionDraft(draft);
				if (validationError) {
					vscode.window.showWarningMessage(validationError);
					break;
				}

				return draft;
			}
			default:
				break;
		}
	}
	}

async function manageDeploymentActions(actions: DeploymentAction[]): Promise<DeploymentAction[]> {
	const draftActions = actions.map(cloneAction);

	while (true) {
		const items: ActionListQuickPickItem[] = [
			{ label: '$(arrow-left) 返回', description: '返回服务器编辑器', action: 'back' },
			...draftActions.map(action => ({
				label: `$(rocket) ${action.name}`,
				description: `${action.timeoutSeconds} 秒`,
				detail: action.command,
				action: 'edit' as const,
				actionId: action.id
			})),
			{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'back' },
			{ label: '$(add) 新增部署动作', description: '添加一个预设远程命令', action: 'add' }
		];

		const selected = await vscode.window.showQuickPick(items, {
			ignoreFocusOut: true,
			placeHolder: '管理部署动作'
		});

		if (!selected || selected.action === 'back') {
			return draftActions;
		}

		if (selected.action === 'add') {
			const created = await editActionDraft({
				id: createActionId(),
				name: `动作 ${draftActions.length + 1}`,
				command: '',
				confirm: true,
				timeoutSeconds: DEPLOYMENT_DEFAULT_TIMEOUT_SECONDS
			}, true);

			if (created && created !== 'delete') {
				draftActions.push(created);
			}

			continue;
		}

		const actionIndex = draftActions.findIndex(action => action.id === selected.actionId);
		if (actionIndex < 0) {
			continue;
		}

		const updated = await editActionDraft(draftActions[actionIndex], false);
		if (updated === 'delete') {
			draftActions.splice(actionIndex, 1);
			continue;
		}

		if (updated) {
			draftActions[actionIndex] = updated;
		}
	}
	}

function buildSecretEnvEditorItems(secretDraft: DeploymentSecretEnvDraft, isNewSecret: boolean): Array<DeploymentQuickPickItem<SecretEnvEditorAction>> {
	return [
		{ label: '$(arrow-left) 返回', description: isNewSecret ? '取消新增变量' : '不保存返回', action: 'cancel' },
		{ label: '$(symbol-key) 变量名', description: secretDraft.key || '未设置', action: 'key' },
		{
			label: '$(lock) 变量值',
			description: secretDraft.value ? '本次已修改' : secretDraft.hasStoredValue ? '已加密保存' : '未设置',
			action: 'value'
		},
		{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'cancel' },
		...(!isNewSecret ? [{ label: '$(trash) 删除变量', description: '删除当前敏感环境变量', action: 'delete' as const }] : []),
		{ label: '$(check) 保存变量', description: '保存当前修改', action: 'save' }
	];
	}

function validateSecretDraft(secretDraft: DeploymentSecretEnvDraft): string | undefined {
	const keyValidationError = validateSecretEnvKey(secretDraft.key);
	if (keyValidationError) {
		return keyValidationError;
	}

	if (!secretDraft.value.trim() && !secretDraft.hasStoredValue) {
		return '敏感环境变量值不能为空';
	}

	return undefined;
	}

async function editSecretDraft(initialDraft: DeploymentSecretEnvDraft, isNewSecret: boolean): Promise<SecretEditorResult> {
	const draft = cloneSecretDraft(initialDraft);

	while (true) {
		const selected = await vscode.window.showQuickPick(buildSecretEnvEditorItems(draft, isNewSecret), {
			ignoreFocusOut: true,
			placeHolder: '编辑敏感环境变量'
		});

		if (!selected || selected.action === 'cancel') {
			return undefined;
		}

		switch (selected.action) {
			case 'key': {
				const key = await promptForSecretEnvKey(draft.key);
				if (key !== undefined) {
					draft.key = key.trim();
				}
				break;
			}
			case 'value': {
				const value = await promptForSecretEnvValue('', draft.hasStoredValue);
				if (value !== undefined) {
					draft.value = value;
				}
				break;
			}
			case 'delete': {
				const confirmed = await vscode.window.showWarningMessage(`确定删除敏感环境变量“${draft.key}”吗？`, { modal: true }, '删除');
				return confirmed === '删除' ? 'delete' : undefined;
			}
			case 'save': {
				const validationError = validateSecretDraft(draft);
				if (validationError) {
					vscode.window.showWarningMessage(validationError);
					break;
				}

				return draft;
			}
			default:
				break;
		}
	}
	}

async function manageSecretEnvDrafts(secretDrafts: DeploymentSecretEnvDraft[]): Promise<DeploymentSecretEnvDraft[]> {
	const drafts = secretDrafts.map(cloneSecretDraft);

	while (true) {
		const items: SecretListQuickPickItem[] = [
			{ label: '$(arrow-left) 返回', description: '返回服务器编辑器', action: 'back' },
			...drafts.map(secretDraft => ({
				label: `$(lock) ${secretDraft.key}`,
				description: secretDraft.value ? '本次已修改' : secretDraft.hasStoredValue ? '已加密保存' : '未设置',
				action: 'edit' as const,
				secretKey: secretDraft.key
			})),
			{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'back' },
			{ label: '$(add) 新增敏感环境变量', description: '例如 DEPLOY_TOKEN / NPM_TOKEN', action: 'add' }
		];

		const selected = await vscode.window.showQuickPick(items, {
			ignoreFocusOut: true,
			placeHolder: '管理敏感环境变量'
		});

		if (!selected || selected.action === 'back') {
			return drafts;
		}

		if (selected.action === 'add') {
			const created = await editSecretDraft({
				key: '',
				value: '',
				hasStoredValue: false
			}, true);

			if (created && created !== 'delete') {
				if (drafts.some(item => item.key.trim() === created.key.trim())) {
					vscode.window.showWarningMessage(`敏感环境变量“${created.key.trim()}”已存在`);
					continue;
				}

				drafts.push(created);
			}

			continue;
		}

		const secretIndex = drafts.findIndex(secretDraft => secretDraft.key === selected.secretKey);
		if (secretIndex < 0) {
			continue;
		}

		const updated = await editSecretDraft(drafts[secretIndex], false);
		if (updated === 'delete') {
			drafts.splice(secretIndex, 1);
			continue;
		}

		if (updated) {
			const duplicate = drafts.some((secretDraft, index) => index !== secretIndex && secretDraft.key.trim() === updated.key.trim());
			if (duplicate) {
				vscode.window.showWarningMessage(`敏感环境变量“${updated.key.trim()}”已存在`);
				continue;
			}

			drafts[secretIndex] = updated;
		}
	}
	}

function buildServerEditorItems(
	server: DeploymentServerProfile,
	secretDrafts: DeploymentSecretEnvDraft[],
	passwordDraft: DeploymentPasswordDraft,
	privateKeyDraft: DeploymentPrivateKeyDraft,
	isNewServer: boolean
): Array<DeploymentQuickPickItem<ServerEditorAction>> {
	return [
		{ label: '$(arrow-left) 返回', description: isNewServer ? '取消新增服务器' : '不保存返回', action: 'cancel' },
		{ label: '$(tag) 名称', description: server.name || '未设置', action: 'name' },
		{ label: '$(folder-library) 分组', description: server.groupPath || '未分组', action: 'groupPath' },
		{ label: '$(note) 备注', description: server.note || '无', action: 'note' },
		{ label: '$(globe) 地址', description: server.host || '未设置', action: 'host' },
		{ label: '$(plug) 端口', description: String(server.port || 22), action: 'port' },
		{ label: '$(account) 用户名', description: server.username || '未设置', action: 'username' },
		{ label: '$(shield) 认证方式', description: getAuthTypeLabel(server.authType), action: 'authType' },
		...(server.authType === 'password'
			? [{
				label: '$(key) SSH 密码',
				description: passwordDraft.value ? '本次已修改' : passwordDraft.hasStoredValue ? '已加密保存' : '未设置',
				action: 'password' as const
			}]
			: server.authType === 'privateKey'
				? [{
					label: '$(file-binary) SSH 私钥',
					description: privateKeyDraft.value ? '本次已修改' : privateKeyDraft.hasStoredValue ? '已加密保存' : '未设置',
					action: 'privateKey' as const
				}]
			: []),
		{ label: '$(lock) 敏感环境变量', description: `${secretDrafts.length} 个`, action: 'secrets' },
		{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'cancel' },
		{ label: '$(beaker) 测试 SSH 连接', description: '验证当前草稿可否连通', action: 'test' },
		{ label: '$(check) 保存服务器', description: '保存当前修改', action: 'save' }
	];
	}

function validateServerDraft(
	server: DeploymentServerProfile,
	secretDrafts: DeploymentSecretEnvDraft[],
	passwordDraft: DeploymentPasswordDraft,
	privateKeyDraft: DeploymentPrivateKeyDraft
): string | undefined {
	if (!server.name.trim()) {
		return '服务器名称不能为空';
	}

	if (!server.host.trim()) {
		return '服务器地址不能为空';
	}

	if (!server.username.trim()) {
		return 'SSH 用户名不能为空';
	}

	if (!Number.isInteger(server.port) || server.port <= 0 || server.port > 65535) {
		return 'SSH 端口必须是 1-65535 之间的整数';
	}

	if (server.authType === 'password' && !passwordDraft.value.trim() && !passwordDraft.hasStoredValue) {
		return '密码登录模式下必须配置 SSH 密码';
	}

	if (server.authType === 'privateKey' && !privateKeyDraft.value.trim() && !privateKeyDraft.hasStoredValue) {
		return '私钥登录模式下必须配置 SSH 私钥';
	}

	const secretKeys = new Set<string>();
	for (const secretDraft of secretDrafts) {
		const validationError = validateSecretDraft(secretDraft);
		if (validationError) {
			return validationError;
		}

		const normalizedKey = secretDraft.key.trim();
		if (secretKeys.has(normalizedKey)) {
			return `敏感环境变量“${normalizedKey}”重复了`;
		}

		secretKeys.add(normalizedKey);
	}

	return undefined;
	}

async function editServerDraft(
	initialServer: DeploymentServerProfile,
	scope: DeploymentScope,
	isNewServer: boolean,
	initialSecretDrafts: DeploymentSecretEnvDraft[],
	initialPasswordDraft: DeploymentPasswordDraft,
	initialPrivateKeyDraft: DeploymentPrivateKeyDraft
): Promise<ServerEditorResult | undefined> {
	const draft: DeploymentServerProfile = {
		...initialServer,
		actions: initialServer.actions.map(cloneAction),
		secretEnvKeys: [...initialServer.secretEnvKeys]
	};
	const previousSecretKeys = [...initialServer.secretEnvKeys];
	let secretDrafts = initialSecretDrafts.map(cloneSecretDraft);
	let passwordDraft = clonePasswordDraft(initialPasswordDraft);
	let privateKeyDraft = clonePrivateKeyDraft(initialPrivateKeyDraft);

	while (true) {
		const selected = await vscode.window.showQuickPick(buildServerEditorItems(draft, secretDrafts, passwordDraft, privateKeyDraft, isNewServer), {
			ignoreFocusOut: true,
			placeHolder: `编辑${getScopeLabel(scope)}部署服务器`
		});

		if (!selected || selected.action === 'cancel') {
			return undefined;
		}

		switch (selected.action) {
			case 'name': {
				const name = await promptForName(draft.name);
				if (name !== undefined) {
					draft.name = name.trim();
				}
				break;
			}
			case 'groupPath': {
				const groupPath = await promptForGroupPath(draft.groupPath || '');
				if (groupPath !== undefined) {
					draft.groupPath = groupPath || undefined;
				}
				break;
			}
			case 'note': {
				const note = await promptForNote(draft.note || '');
				if (note !== undefined) {
					draft.note = note.trim() || undefined;
				}
				break;
			}
			case 'host': {
				const host = await promptForHost(draft.host);
				if (host !== undefined) {
					draft.host = host.trim();
				}
				break;
			}
			case 'port': {
				const port = await promptForPort(draft.port);
				if (port !== undefined) {
					draft.port = port;
				}
				break;
			}
			case 'username': {
				const username = await promptForUsername(draft.username);
				if (username !== undefined) {
					draft.username = username.trim();
				}
				break;
			}
			case 'authType': {
				const authType = await promptForAuthType(draft.authType);
				if (authType !== undefined) {
					draft.authType = authType;
				}
				break;
			}
			case 'password': {
				const password = await promptForPassword(passwordDraft.hasStoredValue);
				if (password !== undefined) {
					passwordDraft.value = password;
				}
				break;
			}
			case 'privateKey': {
				const privateKey = await promptForPrivateKey(privateKeyDraft.hasStoredValue);
				if (privateKey === null) {
					privateKeyDraft = { value: '', hasStoredValue: false };
				} else if (privateKey !== undefined) {
					privateKeyDraft.value = privateKey;
				}
				break;
			}
			case 'secrets': {
				secretDrafts = await manageSecretEnvDrafts(secretDrafts);
				draft.secretEnvKeys = secretDrafts.map(secretDraft => secretDraft.key.trim()).filter(Boolean);
				break;
			}
			case 'test': {
				const validationError = validateServerDraft(draft, secretDrafts, passwordDraft, privateKeyDraft);
				if (validationError) {
					vscode.window.showWarningMessage(validationError);
					break;
				}

				try {
					appendOutputLine(`\n=== 测试部署服务器：${draft.name} ===`);
					await testDeploymentConnection(draft, {
						password: passwordDraft.value.trim() || undefined
						,
						privateKey: privateKeyDraft.value.trim() || undefined
					});
					showOutputChannel(true);
					vscode.window.showInformationMessage(`部署服务器连接测试成功：${draft.name}`);
				} catch (error) {
					logError('测试部署服务器失败:', error);
					showOutputChannel(true);
					vscode.window.showErrorMessage(`测试部署服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
				}
				break;
			}
			case 'save': {
				const validationError = validateServerDraft(draft, secretDrafts, passwordDraft, privateKeyDraft);
				if (validationError) {
					vscode.window.showWarningMessage(validationError);
					break;
				}

				return {
					profile: {
						...draft,
						actions: draft.actions.map(cloneAction),
						secretEnvKeys: secretDrafts.map(secretDraft => secretDraft.key.trim()).filter(Boolean)
					},
					secretDrafts: secretDrafts.map(cloneSecretDraft),
					passwordDraft: clonePasswordDraft(passwordDraft),
					privateKeyDraft: clonePrivateKeyDraft(privateKeyDraft),
					previousSecretKeys,
					scope
				};
			}
			default:
				break;
		}
	}
	}

async function promptForServer(scope?: DeploymentScope, existingServer?: ScopedDeploymentServer): Promise<ServerEditorResult | undefined> {
	const resolvedScope = existingServer?.scope || scope || await promptForScope();
	if (!resolvedScope) {
		return undefined;
	}

	if (resolvedScope === 'workspace' && !hasWorkspaceScope()) {
		throw new Error('当前没有打开工作区，无法新增工作区级部署服务器');
	}

	const state = getDeploymentServersState();
	const initialServer: DeploymentServerProfile = existingServer
		? {
			id: existingServer.id,
			name: existingServer.name,
			groupPath: existingServer.groupPath,
			note: existingServer.note,
			host: existingServer.host,
			port: existingServer.port,
			username: existingServer.username,
			authType: existingServer.authType,
			remoteRoot: existingServer.remoteRoot,
			actions: existingServer.actions.map(cloneAction),
			secretEnvKeys: [...existingServer.secretEnvKeys]
		}
		: {
			id: createServerId(),
			name: `服务器 ${resolvedScope === 'global' ? state.globalServers.length + 1 : state.workspaceServers.length + 1}`,
			groupPath: undefined,
			note: undefined,
			host: '',
			port: 22,
			username: 'root',
			authType: 'system',
			remoteRoot: '',
			actions: [],
			secretEnvKeys: []
		};
	const secretDrafts = existingServer ? await getDeploymentSecretEnvDrafts(existingServer) : [];
	const passwordDraft = existingServer ? await getDeploymentPasswordDraft(existingServer.id) : { value: '', hasStoredValue: false };
	const privateKeyDraft = existingServer ? await getDeploymentPrivateKeyDraft(existingServer.id) : { value: '', hasStoredValue: false };

	return editServerDraft(initialServer, resolvedScope, !existingServer, secretDrafts, passwordDraft, privateKeyDraft);
	}

async function revealServer(serverId: string): Promise<void> {
	if (!deploymentManagementTreeView || !deploymentManagementDataProvider || !serverId) {
		return;
	}

	const target = deploymentManagementDataProvider.getItemById(serverId);
	if (!target) {
		return;
	}

	await deploymentManagementTreeView.reveal(target, {
		select: true,
		focus: false,
		expand: true
	});
	}

function resolveScopeFromCommandArg(commandArg?: unknown): DeploymentScope | undefined {
	if (commandArg instanceof DeploymentGroupRootTreeItem) {
		return commandArg.scope;
	}

	if (commandArg === 'global' || commandArg === 'workspace') {
		return commandArg;
	}

	return undefined;
	}

function resolveServerIdFromCommandArg(commandArg?: unknown): string | undefined {
	if (commandArg instanceof DeploymentServerTreeItem) {
		return commandArg.server.id;
	}

	if (typeof commandArg === 'string' && commandArg) {
		return commandArg;
	}

	if (commandArg && typeof commandArg === 'object' && 'server' in commandArg) {
		const server = (commandArg as { server?: { id?: unknown } }).server;
		if (server && typeof server.id === 'string' && server.id) {
			return server.id;
		}
	}

	return undefined;
	}

async function promptForServerSelection(placeHolder: string): Promise<ScopedDeploymentServer | undefined> {
	const servers = getAllDeploymentServers();
	if (servers.length === 0) {
		vscode.window.showInformationMessage('还没有部署服务器，请先新增一台服务器');
		return undefined;
	}

	const items = servers.map(server => ({
		label: server.name,
		description: `${server.username}@${server.host}:${server.port}`,
		detail: `${getScopeLabel(server.scope)} · ${getAuthTypeLabel(server.authType)}`,
		server
	}));
	const selected = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder
	});

	return selected?.server;
	}

function resolveWorkspaceTargetIdFromCommandArg(commandArg?: unknown): string | undefined {
	if (commandArg instanceof DeploymentWorkspaceTargetTreeItem) {
		return commandArg.target.id;
	}

	if (typeof commandArg === 'string' && commandArg) {
		return commandArg;
	}

	if (commandArg && typeof commandArg === 'object' && 'target' in commandArg) {
		const target = (commandArg as { target?: { id?: unknown } }).target;
		if (target && typeof target.id === 'string' && target.id) {
			return target.id;
		}
	}

	return undefined;
}

async function promptForWorkspaceTargetSelection(placeHolder: string): Promise<DeploymentWorkspaceTarget | undefined> {
	const targets = getWorkspaceDeploymentTargets();
	if (targets.length === 0) {
		vscode.window.showInformationMessage('当前工作区还没有部署目标，请先新增一个');
		return undefined;
	}

	const items = targets.map(target => {
		const resolvedTarget = resolveWorkspaceDeploymentTarget(target.id);
		return {
			label: target.name,
			description: resolvedTarget ? `${resolvedTarget.server.name} / ${resolvedTarget.defaultAction?.name || '未设默认动作'}` : '绑定服务器无效',
			detail: target.remoteRoot || '未设置远程目录',
			target
		};
	});
	const selected = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder
	});

	return selected?.target;
}

function cloneWorkspaceDeploymentTarget(target: DeploymentWorkspaceTarget): DeploymentWorkspaceTarget {
	return {
		id: target.id,
		name: target.name,
		serverId: target.serverId,
		remoteRoot: target.remoteRoot,
		actions: target.actions.map(cloneAction),
		defaultActionId: target.defaultActionId
	};
}

function buildWorkspaceDeploymentEditorItems(
	target: DeploymentWorkspaceTarget,
	resolvedServer?: ScopedDeploymentServer
): Array<DeploymentQuickPickItem<WorkspaceDeploymentTargetEditorAction>> {
	const defaultAction = target.defaultActionId
		? target.actions.find(action => action.id === target.defaultActionId)
		: undefined;

	return [
		{ label: '$(arrow-left) 返回', description: '不保存返回', action: 'cancel' },
		{ label: '$(tag) 目标名称', description: target.name || '未设置', action: 'name' },
		{ label: '$(server-environment) 绑定服务器', description: resolvedServer ? `${resolvedServer.name} (${resolvedServer.username}@${resolvedServer.host}:${resolvedServer.port})` : '未设置', action: 'server' },
		{ label: '$(folder) 远程目录', description: target.remoteRoot || '留空则在远程默认目录执行', action: 'remoteRoot' },
		{ label: '$(rocket) 部署动作', description: `${target.actions.length} 个`, action: 'actions' },
		{ label: '$(target) 默认动作', description: defaultAction?.name || '未设置', action: 'defaultAction' },
		{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'cancel' },
		{ label: '$(trash) 删除部署目标', description: '删除当前部署目标', action: 'delete' },
		{ label: '$(check) 保存部署目标', description: '保存当前部署目标设置', action: 'save' }
	];
}

function validateWorkspaceDeploymentTarget(target: DeploymentWorkspaceTarget): string | undefined {
	if (!target.name.trim()) {
		return '部署目标名称不能为空';
	}

	if (!target.serverId.trim()) {
		return '还没有选择部署服务器';
	}

	if (target.defaultActionId && !target.actions.some(action => action.id === target.defaultActionId)) {
		return '默认动作不存在，请重新选择';
	}

	return undefined;
}

async function promptForDeploymentActionSelection(actions: DeploymentAction[], placeHolder: string): Promise<DeploymentAction | undefined> {
	if (actions.length === 0) {
		return undefined;
	}

	const items = actions.map(action => ({
		label: action.name,
		description: `${action.timeoutSeconds} 秒`,
		detail: action.command,
		action
	}));
	const selected = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder
	});

	return selected?.action;
	}

async function promptForWorkspaceDefaultActionId(actions: DeploymentAction[], currentActionId?: string): Promise<string | null | undefined> {
	if (actions.length === 0) {
		vscode.window.showInformationMessage('请先添加至少一个工作区部署动作');
		return undefined;
	}

	const items = [
		{ label: '$(circle-slash) 不设置默认动作', description: '清除当前默认动作', clear: true },
		...actions.map(action => ({
			label: action.name,
			description: `${action.timeoutSeconds} 秒${currentActionId === action.id ? ' · 当前默认' : ''}`,
			detail: action.command,
			actionId: action.id
		}))
	];
	const selected = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder: '选择默认部署动作'
	});

	if (!selected) {
		return undefined;
	}

	if ('clear' in selected && selected.clear) {
		return null;
	}

	return 'actionId' in selected ? selected.actionId : undefined;
}

async function editWorkspaceDeploymentConfig(
	initialConfig?: DeploymentWorkspaceTarget,
	preferredServerId?: string
	, preferredName?: string
): Promise<DeploymentWorkspaceTarget | 'delete' | undefined> {
	const draft = initialConfig
		? cloneWorkspaceDeploymentTarget(initialConfig)
		: {
			id: createWorkspaceTargetId(),
			name: preferredName || `部署目标 ${getWorkspaceDeploymentTargets().length + 1}`,
			serverId: preferredServerId || '',
			remoteRoot: '',
			actions: [],
			defaultActionId: undefined
		};

	if (preferredServerId) {
		draft.serverId = preferredServerId;
	}

	while (true) {
		const resolvedServer = draft.serverId ? getDeploymentServerById(draft.serverId) : undefined;
		const selected = await vscode.window.showQuickPick(buildWorkspaceDeploymentEditorItems(draft, resolvedServer), {
			ignoreFocusOut: true,
			placeHolder: '编辑部署目标'
		});

		if (!selected || selected.action === 'cancel') {
			return undefined;
		}

		switch (selected.action) {
			case 'name': {
				const name = await promptForTargetName(draft.name);
				if (name !== undefined) {
					draft.name = name.trim();
				}
				break;
			}
			case 'server': {
				const server = await promptForServerSelection('选择工作区部署服务器');
				if (server) {
					draft.serverId = server.id;
				}
				break;
			}
			case 'remoteRoot': {
				const remoteRoot = await promptForRemoteRoot(draft.remoteRoot);
				if (remoteRoot !== undefined) {
					draft.remoteRoot = remoteRoot.trim();
				}
				break;
			}
			case 'actions': {
				draft.actions = await manageDeploymentActions(draft.actions);
				if (draft.defaultActionId && !draft.actions.some(action => action.id === draft.defaultActionId)) {
					draft.defaultActionId = undefined;
				}
				break;
			}
			case 'defaultAction': {
				const actionId = await promptForWorkspaceDefaultActionId(draft.actions, draft.defaultActionId);
				if (actionId === null) {
					draft.defaultActionId = undefined;
				} else if (actionId !== undefined) {
					draft.defaultActionId = actionId;
				}
				break;
			}
			case 'delete': {
				const confirmed = await vscode.window.showWarningMessage(`确定删除部署目标“${draft.name}”吗？`, { modal: true }, '删除');
				return confirmed === '删除' ? 'delete' : undefined;
			}
			case 'save': {
				const validationError = validateWorkspaceDeploymentTarget(draft);
				if (validationError) {
					vscode.window.showWarningMessage(validationError);
					break;
				}

				return cloneWorkspaceDeploymentTarget(draft);
			}
			default:
				break;
		}
	}
}

function buildWorkspaceDeploymentRuntimeServer(resolvedConfig: ReturnType<typeof resolveWorkspaceDeploymentTarget>): DeploymentServerProfile {
	if (!resolvedConfig) {
		throw new Error('当前部署目标无效');
	}

	return {
		...resolvedConfig.server,
		remoteRoot: resolvedConfig.remoteRoot,
		actions: resolvedConfig.actions.map(cloneAction)
	};
}

async function saveServerProfile(result: ServerEditorResult): Promise<void> {
	const state = getDeploymentServersState();
	const scopeServers = result.scope === 'global' ? state.globalServers : state.workspaceServers;
	const serverIndex = scopeServers.findIndex(server => server.id === result.profile.id);
	const nextProfile: DeploymentServerProfile = {
		...result.profile,
		secretEnvKeys: result.secretDrafts.map(secretDraft => secretDraft.key.trim()).filter(Boolean)
	};
	const nextServers = serverIndex >= 0
		? scopeServers.map(server => server.id === nextProfile.id ? nextProfile : server)
		: [...scopeServers, nextProfile];

	await updateDeploymentServers(result.scope, nextServers);
	await saveDeploymentSecretEnvDrafts(nextProfile.id, result.previousSecretKeys, result.secretDrafts);
	await saveDeploymentPasswordDraft(nextProfile.id, nextProfile.authType === 'password' ? result.passwordDraft : { value: '', hasStoredValue: false });
	await saveDeploymentPrivateKeyDraft(nextProfile.id, nextProfile.authType === 'privateKey' ? result.privateKeyDraft : { value: '', hasStoredValue: false });
	await reconcileWorkspaceDeploymentTargets();
	deploymentManagementDataProvider?.refresh();
	await revealServer(nextProfile.id);
	}

async function saveWorkspaceDeploymentTarget(target: DeploymentWorkspaceTarget): Promise<void> {
	const targets = getWorkspaceDeploymentTargets();
	const targetIndex = targets.findIndex(item => item.id === target.id);
	const nextTargets = targetIndex >= 0
		? targets.map(item => item.id === target.id ? cloneWorkspaceDeploymentTarget(target) : item)
		: [...targets, cloneWorkspaceDeploymentTarget(target)];

	await updateWorkspaceDeploymentTargets(nextTargets);
	deploymentManagementDataProvider?.refresh();
	const server = getDeploymentServerById(target.serverId);
	vscode.window.showInformationMessage(`部署目标已保存：${target.name}${server ? ` (${server.name})` : ''}`);
	}

async function reconcileWorkspaceDeploymentTargets(): Promise<void> {
	const workspaceTargets = getWorkspaceDeploymentTargets();
	const nextTargets = workspaceTargets.filter(target => Boolean(getDeploymentServerById(target.serverId)));
	if (nextTargets.length === workspaceTargets.length) {
		return;
	}

	await updateWorkspaceDeploymentTargets(nextTargets);
	}

async function handleAddServer(commandArg?: unknown): Promise<void> {
	const scope = resolveScopeFromCommandArg(commandArg);
	const result = await promptForServer(scope);
	if (!result) {
		return;
	}

	await saveServerProfile(result);
	vscode.window.showInformationMessage(`已新增部署服务器：${result.profile.name}`);
	}

async function handleEditServer(itemOrServerId?: DeploymentServerTreeItem | string): Promise<void> {
	const serverId = typeof itemOrServerId === 'string' ? itemOrServerId : resolveServerIdFromCommandArg(itemOrServerId);
	const existingServer = serverId ? getDeploymentServerById(serverId) : await promptForServerSelection('选择要编辑的部署服务器');
	if (!existingServer) {
		return;
	}

	const result = await promptForServer(existingServer.scope, existingServer);
	if (!result) {
		return;
	}

	await saveServerProfile(result);
	vscode.window.showInformationMessage(`已更新部署服务器：${result.profile.name}`);
	}

async function handleDeleteServer(itemOrServerId?: DeploymentServerTreeItem | string): Promise<void> {
	const serverId = typeof itemOrServerId === 'string' ? itemOrServerId : resolveServerIdFromCommandArg(itemOrServerId);
	const server = serverId ? getDeploymentServerById(serverId) : await promptForServerSelection('选择要删除的部署服务器');
	if (!server) {
		return;
	}

	const confirmed = await vscode.window.showWarningMessage(`确定删除部署服务器“${server.name}”吗？`, { modal: true }, '删除');
	if (confirmed !== '删除') {
		return;
	}

	const state = getDeploymentServersState();
	const scopeServers = server.scope === 'global' ? state.globalServers : state.workspaceServers;
	await updateDeploymentServers(server.scope, scopeServers.filter(item => item.id !== server.id));
	await deleteDeploymentSecrets(server.id, server.secretEnvKeys);
	await reconcileWorkspaceDeploymentTargets();
	deploymentManagementDataProvider?.refresh();
	vscode.window.showInformationMessage(`已删除部署服务器：${server.name}`);
	}

async function handleTestServer(itemOrServerId?: DeploymentServerTreeItem | string): Promise<void> {
	const serverId = typeof itemOrServerId === 'string' ? itemOrServerId : resolveServerIdFromCommandArg(itemOrServerId);
	const server = serverId ? getDeploymentServerById(serverId) : await promptForServerSelection('选择要测试连接的部署服务器');
	if (!server) {
		return;
	}

	appendOutputLine(`\n=== 测试部署服务器：${server.name} ===`);
	await testDeploymentConnection(server);
	showOutputChannel(true);
	vscode.window.showInformationMessage(`部署服务器连接测试成功：${server.name}`, '查看输出').then(selection => {
		if (selection === '查看输出') {
			showOutputChannel(true);
		}
	});
	}

async function handleOpenServerTerminal(itemOrServerId?: DeploymentServerTreeItem | string): Promise<void> {
	const serverId = typeof itemOrServerId === 'string' ? itemOrServerId : resolveServerIdFromCommandArg(itemOrServerId);
	const server = serverId ? getDeploymentServerById(serverId) : await promptForServerSelection('选择要打开终端的服务器');
	if (!server) {
		return;
	}

	await openDeploymentServerTerminal(server);
	}

async function handleUploadFiles(itemOrServerId?: DeploymentServerTreeItem | string): Promise<void> {
	const serverId = typeof itemOrServerId === 'string' ? itemOrServerId : resolveServerIdFromCommandArg(itemOrServerId);
	const server = serverId ? getDeploymentServerById(serverId) : await promptForServerSelection('选择要上传文件的服务器');
	if (!server) {
		return;
	}

	const fileUris = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: true,
		openLabel: '选择要上传的文件'
	});
	if (!fileUris || fileUris.length === 0) {
		return;
	}

	const remoteDirectory = await promptForUploadDirectory(server.remoteRoot || '');
	if (remoteDirectory === undefined) {
		return;
	}

	appendOutputLine(`\n=== 上传文件到服务器：${server.name} ===`);
	await uploadFilesToDeploymentServer(server, fileUris.map(uri => uri.fsPath), remoteDirectory.trim());
	showOutputChannel(true);
	vscode.window.showInformationMessage(`文件上传成功：${server.name} -> ${remoteDirectory.trim()}`, '查看输出').then(selection => {
		if (selection === '查看输出') {
			showOutputChannel(true);
		}
	});
	}

async function normalizeExplorerResourceUris(resource?: vscode.Uri, resources?: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
	const candidates = resources && resources.length > 0 ? [...resources] : resource ? [resource] : [];
	const fileUris = candidates.filter(uri => uri.scheme === 'file');
	if (fileUris.length === 0) {
		return [];
	}

	const stats = await Promise.all(fileUris.map(async uri => ({
		uri,
		stat: await vscode.workspace.fs.stat(uri)
	})));

	return stats
		.filter(entry => (entry.stat.type & vscode.FileType.File) !== 0)
		.map(entry => entry.uri);
	}

async function handleUploadExplorerResources(resource?: vscode.Uri, resources?: readonly vscode.Uri[]): Promise<void> {
	const fileUris = await normalizeExplorerResourceUris(resource, resources);
	if (fileUris.length === 0) {
		vscode.window.showInformationMessage('请在资源管理器中选择至少一个文件进行上传');
		return;
	}

	const target = await promptForWorkspaceTargetSelection('选择要上传到的部署目标');
	if (!target) {
		return;
	}

	const resolvedTarget = resolveWorkspaceDeploymentTarget(target.id);
	if (!resolvedTarget) {
		vscode.window.showWarningMessage(`部署目标“${target.name}”当前无效，请检查绑定服务器是否存在`);
		return;
	}

	const remoteDirectory = await promptForTargetUploadDirectory(target.name, target.remoteRoot || '');
	if (!remoteDirectory || remoteDirectory === undefined) {
		return;
	}

	appendOutputLine(`\n=== 从资源管理器上传文件：${target.name} / ${resolvedTarget.server.name} ===`);
	const runtimeServer = buildWorkspaceDeploymentRuntimeServer(resolvedTarget);
	await uploadFilesToDeploymentServer(runtimeServer, fileUris.map(uri => uri.fsPath), remoteDirectory.trim());
	showOutputChannel(true);
	const uploadedNames = fileUris.length === 1 ? fileUris[0].path.split('/').pop() || '文件' : `${fileUris.length} 个文件`;
	vscode.window.showInformationMessage(`上传成功：${uploadedNames} -> ${target.name}`, '查看输出').then(selection => {
		if (selection === '查看输出') {
			showOutputChannel(true);
		}
	});
	}

async function handleAddWorkspaceDeploymentTarget(itemOrServerId?: DeploymentServerTreeItem | string): Promise<void> {
	const serverId = typeof itemOrServerId === 'string' ? itemOrServerId : resolveServerIdFromCommandArg(itemOrServerId);
	const nextTarget = await editWorkspaceDeploymentConfig(undefined, serverId);
	if (!nextTarget || nextTarget === 'delete') {
		return;
	}

	await saveWorkspaceDeploymentTarget(nextTarget);
	}

async function handleEditWorkspaceDeploymentTarget(itemOrTargetId?: DeploymentWorkspaceTargetTreeItem | string): Promise<void> {
	const targetId = typeof itemOrTargetId === 'string' ? itemOrTargetId : resolveWorkspaceTargetIdFromCommandArg(itemOrTargetId);
	const target = targetId ? getWorkspaceDeploymentTargetById(targetId) : await promptForWorkspaceTargetSelection('选择要编辑的部署目标');
	if (!target) {
		return;
	}

	const nextTarget = await editWorkspaceDeploymentConfig(target);
	if (!nextTarget) {
		return;
	}

	if (nextTarget === 'delete') {
		await handleDeleteWorkspaceDeploymentTarget(target.id);
		return;
	}

	await saveWorkspaceDeploymentTarget(nextTarget);
	}

async function handleDeleteWorkspaceDeploymentTarget(itemOrTargetId?: DeploymentWorkspaceTargetTreeItem | string): Promise<void> {
	const targetId = typeof itemOrTargetId === 'string' ? itemOrTargetId : resolveWorkspaceTargetIdFromCommandArg(itemOrTargetId);
	const target = targetId ? getWorkspaceDeploymentTargetById(targetId) : await promptForWorkspaceTargetSelection('选择要删除的部署目标');
	if (!target) {
		return;
	}

	const confirmed = await vscode.window.showWarningMessage(`确定删除部署目标“${target.name}”吗？`, { modal: true }, '删除');
	if (confirmed !== '删除') {
		return;
	}

	await updateWorkspaceDeploymentTargets(getWorkspaceDeploymentTargets().filter(item => item.id !== target.id));
	deploymentManagementDataProvider?.refresh();
	vscode.window.showInformationMessage(`已删除部署目标：${target.name}`);
	}

async function handleRunAction(itemOrTargetId?: DeploymentWorkspaceTargetTreeItem | string): Promise<void> {
	const targetId = typeof itemOrTargetId === 'string' ? itemOrTargetId : resolveWorkspaceTargetIdFromCommandArg(itemOrTargetId);
	const target = targetId ? getWorkspaceDeploymentTargetById(targetId) : await promptForWorkspaceTargetSelection('选择要执行的部署目标');
	if (!target) {
		return;
	}

	const resolvedTarget = resolveWorkspaceDeploymentTarget(target.id);
	if (!resolvedTarget) {
		vscode.window.showWarningMessage(`部署目标“${target.name}”当前无效，请检查绑定服务器是否存在`);
		return;
	}

	if (resolvedTarget.actions.length === 0) {
		const selection = await vscode.window.showInformationMessage(`部署目标“${target.name}”还没有部署动作`, '去编辑');
		if (selection === '去编辑') {
			await handleEditWorkspaceDeploymentTarget(target.id);
		}
		return;
	}

	const action = await promptForDeploymentActionSelection(
		resolvedTarget.actions,
		`选择要在“${target.name} / ${resolvedTarget.server.name}”上执行的部署动作`
	);
	if (!action) {
		return;
	}

	if (action.confirm) {
		const confirmed = await vscode.window.showWarningMessage(
			`确定在“${target.name} / ${resolvedTarget.server.name}”上执行动作“${action.name}”吗？`,
			{ modal: true },
			'执行'
		);
		if (confirmed !== '执行') {
			return;
		}
	}

	const runtimeServer = buildWorkspaceDeploymentRuntimeServer(resolvedTarget);
	appendOutputLine(`\n=== 执行部署动作：${target.name} / ${resolvedTarget.server.name} / ${action.name} ===`);
	await runDeploymentAction(runtimeServer, action);
	showOutputChannel(true);
	vscode.window.showInformationMessage(`部署动作执行成功：${target.name} / ${resolvedTarget.server.name} / ${action.name}`, '查看输出').then(selection => {
		if (selection === '查看输出') {
			showOutputChannel(true);
		}
	});
	}

async function handleRunDefaultDeploymentAction(itemOrTargetId?: DeploymentWorkspaceTargetTreeItem | string): Promise<void> {
	const targetId = typeof itemOrTargetId === 'string' ? itemOrTargetId : resolveWorkspaceTargetIdFromCommandArg(itemOrTargetId);
	const target = targetId ? getWorkspaceDeploymentTargetById(targetId) : await promptForWorkspaceTargetSelection('选择要执行默认部署的目标');
	if (!target) {
		return;
	}

	const resolvedTarget = resolveWorkspaceDeploymentTarget(target.id);
	if (!resolvedTarget) {
		vscode.window.showWarningMessage(`部署目标“${target.name}”当前无效，请检查绑定服务器是否存在`);
		return;
	}

	if (!resolvedTarget.defaultAction) {
		const selection = await vscode.window.showInformationMessage(`部署目标“${target.name}”还没有默认动作`, '去编辑');
		if (selection === '去编辑') {
			await handleEditWorkspaceDeploymentTarget(target.id);
		}
		return;
	}

	if (resolvedTarget.defaultAction.confirm) {
		const confirmed = await vscode.window.showWarningMessage(
			`确定执行默认部署：${target.name} / ${resolvedTarget.server.name} / ${resolvedTarget.defaultAction.name} 吗？`,
			{ modal: true },
			'执行'
		);
		if (confirmed !== '执行') {
			return;
		}
	}

	const runtimeServer = buildWorkspaceDeploymentRuntimeServer(resolvedTarget);
	appendOutputLine(`\n=== 执行默认部署：${target.name} / ${resolvedTarget.server.name} / ${resolvedTarget.defaultAction.name} ===`);
	await runDeploymentAction(runtimeServer, resolvedTarget.defaultAction);
	showOutputChannel(true);
	vscode.window.showInformationMessage(`默认部署执行成功：${target.name} / ${resolvedTarget.server.name} / ${resolvedTarget.defaultAction.name}`, '查看输出').then(selection => {
		if (selection === '查看输出') {
			showOutputChannel(true);
		}
	});
	}

async function handleExportServers(): Promise<void> {
	await exportDeploymentConfiguration();
	}

async function handleImportServers(): Promise<void> {
	await importDeploymentConfiguration();
	deploymentManagementDataProvider?.refresh();
	}

export function registerDeploymentManagementPanel(context: vscode.ExtensionContext): void {
	initializeDeploymentSecretStorage(context);
	registerDeploymentTerminalCleanup(context);
	deploymentManagementDataProvider = new DeploymentManagementTreeDataProvider();
	deploymentManagementTreeView = vscode.window.createTreeView(DEPLOYMENT_VIEW_ID, {
		treeDataProvider: deploymentManagementDataProvider,
		showCollapseAll: false,
		canSelectMany: false
	});
	updateDeploymentManagementViewMetadata();

	context.subscriptions.push(deploymentManagementTreeView);
	context.subscriptions.push(vscode.commands.registerCommand(OPEN_DEPLOYMENT_MANAGEMENT_COMMAND, () => {
		openDeploymentManagementPanel();
	}));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_WORKSPACE_DEPLOYMENT_TARGET_COMMAND, async (item?: DeploymentServerTreeItem) => {
		try {
			await handleAddWorkspaceDeploymentTarget(item);
		} catch (error) {
			logError('新增部署目标失败:', error);
			vscode.window.showErrorMessage(`新增部署目标失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(EDIT_WORKSPACE_DEPLOYMENT_TARGET_COMMAND, async (item?: DeploymentWorkspaceTargetTreeItem) => {
		try {
			await handleEditWorkspaceDeploymentTarget(item);
		} catch (error) {
			logError('编辑部署目标失败:', error);
			vscode.window.showErrorMessage(`编辑部署目标失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(DELETE_WORKSPACE_DEPLOYMENT_TARGET_COMMAND, async (item?: DeploymentWorkspaceTargetTreeItem) => {
		try {
			await handleDeleteWorkspaceDeploymentTarget(item);
		} catch (error) {
			logError('删除部署目标失败:', error);
			vscode.window.showErrorMessage(`删除部署目标失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(RUN_DEFAULT_DEPLOYMENT_ACTION_COMMAND, async (item?: DeploymentWorkspaceTargetTreeItem) => {
		try {
			await handleRunDefaultDeploymentAction(item);
		} catch (error) {
			logError('执行默认部署失败:', error);
			showOutputChannel(true);
			vscode.window.showErrorMessage(`执行默认部署失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(EXPORT_DEPLOYMENT_SERVERS_COMMAND, async () => {
		try {
			await handleExportServers();
		} catch (error) {
			logError('导出部署配置失败:', error);
			vscode.window.showErrorMessage(`导出部署配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(IMPORT_DEPLOYMENT_SERVERS_COMMAND, async () => {
		try {
			await handleImportServers();
		} catch (error) {
			logError('导入部署配置失败:', error);
			vscode.window.showErrorMessage(`导入部署配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_DEPLOYMENT_SERVER_COMMAND, async (item?: DeploymentGroupRootTreeItem) => {
		try {
			await handleAddServer(item);
		} catch (error) {
			logError('新增部署服务器失败:', error);
			vscode.window.showErrorMessage(`新增部署服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(EDIT_DEPLOYMENT_SERVER_COMMAND, async (item?: DeploymentServerTreeItem) => {
		try {
			await handleEditServer(item);
		} catch (error) {
			logError('编辑部署服务器失败:', error);
			vscode.window.showErrorMessage(`编辑部署服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(DELETE_DEPLOYMENT_SERVER_COMMAND, async (item?: DeploymentServerTreeItem) => {
		try {
			await handleDeleteServer(item);
		} catch (error) {
			logError('删除部署服务器失败:', error);
			vscode.window.showErrorMessage(`删除部署服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(TEST_DEPLOYMENT_SERVER_COMMAND, async (item?: DeploymentServerTreeItem) => {
		try {
			await handleTestServer(item);
		} catch (error) {
			logError('测试部署服务器失败:', error);
			showOutputChannel(true);
			vscode.window.showErrorMessage(`测试部署服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(OPEN_DEPLOYMENT_SERVER_TERMINAL_COMMAND, async (item?: DeploymentServerTreeItem) => {
		try {
			await handleOpenServerTerminal(item);
		} catch (error) {
			logError('打开服务器终端失败:', error);
			vscode.window.showErrorMessage(`打开服务器终端失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(UPLOAD_DEPLOYMENT_FILES_COMMAND, async (item?: DeploymentServerTreeItem) => {
		try {
			await handleUploadFiles(item);
		} catch (error) {
			logError('上传文件失败:', error);
			showOutputChannel(true);
			vscode.window.showErrorMessage(`上传文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(UPLOAD_EXPLORER_RESOURCES_COMMAND, async (resource?: vscode.Uri, resources?: readonly vscode.Uri[]) => {
		try {
			await handleUploadExplorerResources(resource, resources);
		} catch (error) {
			logError('从资源管理器上传文件失败:', error);
			showOutputChannel(true);
			vscode.window.showErrorMessage(`上传文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(RUN_DEPLOYMENT_ACTION_COMMAND, async (item?: DeploymentWorkspaceTargetTreeItem) => {
		try {
			await handleRunAction(item);
		} catch (error) {
			logError('执行部署动作失败:', error);
			showOutputChannel(true);
			vscode.window.showErrorMessage(`执行部署动作失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(REFRESH_DEPLOYMENT_SERVERS_COMMAND, () => {
		deploymentManagementDataProvider?.refresh();
	}));
	}

export function openDeploymentManagementPanel(): void {
	void vscode.commands.executeCommand(`workbench.view.extension.${DEPLOYMENT_VIEW_CONTAINER_ID}`);
	}