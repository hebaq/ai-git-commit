import * as vscode from 'vscode';

import {
	ACTIVE_PROVIDER_PROFILE_ID_SETTING,
	ACTIVE_PROVIDER_PROFILE_ITEM_CONTEXT,
	ACTIVATE_PROVIDER_PROFILE_COMMAND,
	ADD_PROVIDER_PROFILE_COMMAND,
	CONFIG_NAMESPACE,
	DELETE_PROVIDER_PROFILE_COMMAND,
	EDIT_PROVIDER_PROFILE_COMMAND,
	PROVIDER_MANAGEMENT_PANEL_TITLE,
	PROVIDER_MANAGEMENT_VIEW_CONTAINER_ID,
	PROVIDER_MANAGEMENT_VIEW_ID,
	PROVIDER_PROFILES_SETTING,
	PROVIDER_PROFILE_ITEM_CONTEXT,
	REFRESH_PROVIDER_PROFILES_COMMAND
} from './constants';
import {
	getDefaultModel,
	getProviderProfileById,
	getProviderProfilesState,
	resolveAIConfigFromProfile,
	updateProviderProfilesState
} from './config';
import { testAIConfigConnection } from './modelTest';
import { logError, showOutputChannel } from './output';
import type { AIProfile, AIProvider, ProviderProfilesState } from './types';

const PROVIDER_GROUP_ROOT_ID = 'ai-provider-group-root';
const PROVIDER_PROFILE_TREE_MIME = 'application/vnd.hebai-ai-git-commit.provider-profiles';
const PROVIDER_PROFILES_CONFIGURATION_KEY = `${CONFIG_NAMESPACE}.${PROVIDER_PROFILES_SETTING}`;
const ACTIVE_PROVIDER_PROFILE_ID_CONFIGURATION_KEY = `${CONFIG_NAMESPACE}.${ACTIVE_PROVIDER_PROFILE_ID_SETTING}`;

let providerManagementDataProvider: ProviderManagementTreeDataProvider | undefined;
let providerManagementTreeView: vscode.TreeView<ProviderManagementTreeItem> | undefined;

type ProviderManagementTreeItem = ProviderProfilesRootTreeItem | ProviderProfileTreeItem;

class ProviderProfilesRootTreeItem extends vscode.TreeItem {
	constructor(profileCount: number) {
		super('AI 供应商', vscode.TreeItemCollapsibleState.Expanded);
		this.id = PROVIDER_GROUP_ROOT_ID;
		this.description = `${profileCount} 个配置`;
		this.tooltip = `AI 供应商 (${profileCount} 个配置)`;
		this.iconPath = new vscode.ThemeIcon('folder-library');
		this.contextValue = 'providerProfilesRoot';
	}
}

class ProviderProfileTreeItem extends vscode.TreeItem {
	constructor(public readonly profile: AIProfile, public readonly isActive: boolean) {
		super(profile.name, vscode.TreeItemCollapsibleState.None);
		this.id = profile.id;
		this.description = `${getProviderLabel(profile.provider)} · ${profile.model || getDefaultModel(profile.provider)}`;
		this.tooltip = new vscode.MarkdownString([
			`**${profile.name}**`,
			`- Provider: ${getProviderLabel(profile.provider)}`,
			`- Model: ${profile.model || getDefaultModel(profile.provider)}`,
			`- Base URL: ${profile.baseUrl || '默认地址'}`,
			`- 状态: ${isActive ? '当前激活' : '未激活'}`
		].join('\n'));
		this.contextValue = isActive ? ACTIVE_PROVIDER_PROFILE_ITEM_CONTEXT : PROVIDER_PROFILE_ITEM_CONTEXT;
		this.iconPath = isActive
			? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
			: new vscode.ThemeIcon('plug');
	}
}

class ProviderManagementTreeDataProvider implements vscode.TreeDataProvider<ProviderManagementTreeItem> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ProviderManagementTreeItem | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
		updateProviderManagementViewMetadata();
	}

	getTreeItem(element: ProviderManagementTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: ProviderManagementTreeItem): ProviderManagementTreeItem[] {
		const state = getProviderProfilesState();

		if (!element) {
			return [new ProviderProfilesRootTreeItem(state.profiles.length)];
		}

		if (element instanceof ProviderProfilesRootTreeItem) {
			return state.profiles.map(profile => new ProviderProfileTreeItem(profile, profile.id === state.activeProfileId));
		}

		return [];
	}

	getParent(element: ProviderManagementTreeItem): ProviderManagementTreeItem | null {
		if (element instanceof ProviderProfileTreeItem) {
			return new ProviderProfilesRootTreeItem(getProviderProfilesState().profiles.length);
		}

		return null;
	}

	getItemById(profileId: string): ProviderProfileTreeItem | undefined {
		const state = getProviderProfilesState();
		const profile = state.profiles.find(item => item.id === profileId);
		return profile ? new ProviderProfileTreeItem(profile, profile.id === state.activeProfileId) : undefined;
	}
}

class ProviderProfilesDragAndDropController implements vscode.TreeDragAndDropController<ProviderManagementTreeItem> {
	readonly dragMimeTypes = [PROVIDER_PROFILE_TREE_MIME];
	readonly dropMimeTypes = [PROVIDER_PROFILE_TREE_MIME];

	handleDrag(source: readonly ProviderManagementTreeItem[], dataTransfer: vscode.DataTransfer): void {
		const draggedProfileIds = source
			.filter((item): item is ProviderProfileTreeItem => item instanceof ProviderProfileTreeItem)
			.map(item => item.profile.id);

		if (draggedProfileIds.length === 0) {
			return;
		}

		dataTransfer.set(PROVIDER_PROFILE_TREE_MIME, new vscode.DataTransferItem(JSON.stringify(draggedProfileIds)));
	}

	async handleDrop(target: ProviderManagementTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
		const transferItem = dataTransfer.get(PROVIDER_PROFILE_TREE_MIME);
		if (!transferItem) {
			return;
		}

		const rawValue = await transferItem.asString();
		const draggedProfileIds = JSON.parse(rawValue) as string[];
		if (!Array.isArray(draggedProfileIds) || draggedProfileIds.length === 0) {
			return;
		}

		const state = getProviderProfilesState();
		const draggedIdSet = new Set(draggedProfileIds);
		const remainingProfiles = state.profiles.filter(profile => !draggedIdSet.has(profile.id));
		const draggedProfiles = state.profiles.filter(profile => draggedIdSet.has(profile.id));

		if (draggedProfiles.length === 0) {
			return;
		}

		let insertIndex = remainingProfiles.length;
		if (target instanceof ProviderProfileTreeItem) {
			const targetIndex = remainingProfiles.findIndex(profile => profile.id === target.profile.id);
			if (targetIndex >= 0) {
				insertIndex = targetIndex;
			}
		}

		const nextProfiles = [...remainingProfiles];
		nextProfiles.splice(insertIndex, 0, ...draggedProfiles);

		await saveProfiles({
			profiles: nextProfiles,
			activeProfileId: state.activeProfileId
		});
		await revealProfile(draggedProfiles[0].id);
	}
}

function getProviderLabel(provider: AIProvider): string {
	switch (provider) {
		case 'openai':
			return 'OpenAI';
		case 'openai-response':
			return 'OpenAI Responses';
		case 'claude':
			return 'Claude';
		case 'gemini':
			return 'Gemini';
		default:
			return 'OpenAI';
	}
}

function createProfileId(): string {
	return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type ProfileEditorAction = 'cancel' | 'name' | 'provider' | 'model' | 'baseUrl' | 'apiKey' | 'test' | 'save';

interface ProfileEditorItem extends vscode.QuickPickItem {
	action: ProfileEditorAction;
}

function updateProviderManagementViewMetadata(): void {
	if (!providerManagementTreeView) {
		return;
	}

	const { profiles, activeProfileId } = getProviderProfilesState();
	const activeProfile = profiles.find(profile => profile.id === activeProfileId);
	providerManagementTreeView.title = PROVIDER_MANAGEMENT_PANEL_TITLE;
	providerManagementTreeView.description = activeProfile ? `当前: ${activeProfile.name}` : '未配置';
	providerManagementTreeView.badge = undefined;
	providerManagementTreeView.message = profiles.length === 0 ? '还没有 AI 配置。点击标题栏的“新增配置”开始。' : undefined;
}

async function saveProfiles(nextState: ProviderProfilesState): Promise<void> {
	await updateProviderProfilesState(nextState);
	providerManagementDataProvider?.refresh();
}

async function promptForProfileName(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入配置名称',
		placeHolder: '例如：默认 OpenAI / 团队 Claude',
		value: defaultValue,
		validateInput: value => value.trim() ? undefined : '配置名称不能为空'
	});
}

async function promptForProvider(defaultProvider: AIProvider): Promise<AIProvider | undefined> {
	const items: Array<vscode.QuickPickItem & { provider: AIProvider }> = [
		{ label: 'OpenAI', description: 'chat.completions', provider: 'openai', picked: defaultProvider === 'openai' },
		{ label: 'OpenAI Responses API', description: '/v1/responses', provider: 'openai-response', picked: defaultProvider === 'openai-response' },
		{ label: 'Claude', description: 'Anthropic Claude', provider: 'claude', picked: defaultProvider === 'claude' },
		{ label: 'Gemini', description: 'Google Gemini', provider: 'gemini', picked: defaultProvider === 'gemini' }
	];

	const selected = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder: '选择 AI 供应商'
	});

	return selected?.provider;
}

async function promptForModel(defaultValue: string, provider: AIProvider): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: `输入 ${getProviderLabel(provider)} 模型名称`,
		placeHolder: getDefaultModel(provider),
		value: defaultValue || getDefaultModel(provider),
		validateInput: value => value.trim() ? undefined : '模型名称不能为空'
	});
}

async function promptForBaseUrl(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		prompt: '输入 Base URL，可留空使用默认地址',
		placeHolder: '例如：https://api.openai.com/v1',
		value: defaultValue
	});
}

async function promptForApiKey(defaultValue: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		password: true,
		prompt: '输入 API Key',
		placeHolder: 'sk-...',
		value: defaultValue,
		validateInput: value => value.trim() ? undefined : 'API Key 不能为空'
	});
}

function buildProfileEditorItems(profile: AIProfile, isNewProfile: boolean): ProfileEditorItem[] {
	return [
		{
			label: '$(arrow-left) 返回',
			description: isNewProfile ? '取消新增' : '不保存返回',
			action: 'cancel'
		},
		{
			label: '$(tag) 名称',
			description: profile.name || '未设置',
			action: 'name'
		},
		{
			label: '$(hubot) AI 格式',
			description: getProviderLabel(profile.provider),
			action: 'provider'
		},
		{
			label: '$(package) 模型',
			description: profile.model || getDefaultModel(profile.provider),
			action: 'model'
		},
		{
			label: '$(globe) API 基础 URL',
			description: profile.baseUrl || '默认地址',
			action: 'baseUrl'
		},
		{
			label: '$(shield) 身份验证',
			description: profile.apiKey ? 'API Key 已配置' : '未配置',
			action: 'apiKey'
		},
		{
			label: '',
			kind: vscode.QuickPickItemKind.Separator,
			action: 'cancel'
		},
		{
			label: '$(beaker) 测试当前配置',
			description: '发送 who are you? 验证当前草稿',
			action: 'test'
		},
		{
			label: '$(check) 保存配置',
			description: '保存当前修改',
			action: 'save'
		}
	];
}

function validateProfileDraft(profile: AIProfile): string | undefined {
	if (!profile.name.trim()) {
		return '配置名称不能为空';
	}

	if (!profile.model.trim()) {
		return '模型名称不能为空';
	}

	if (!profile.apiKey.trim()) {
		return 'API Key 不能为空';
	}

	return undefined;
}

async function editProfileDraft(initialProfile: AIProfile, isNewProfile: boolean): Promise<AIProfile | undefined> {
	const draft = { ...initialProfile };

	while (true) {
		const selected = await vscode.window.showQuickPick(buildProfileEditorItems(draft, isNewProfile), {
			ignoreFocusOut: true,
			placeHolder: '选择要编辑的字段'
		});

		if (!selected || selected.action === 'cancel') {
			return undefined;
		}

		switch (selected.action) {
			case 'name': {
				const name = await promptForProfileName(draft.name);
				if (name !== undefined) {
					draft.name = name.trim();
				}
				break;
			}
			case 'provider': {
				const previousProvider = draft.provider;
				const provider = await promptForProvider(draft.provider);
				if (provider !== undefined) {
					draft.provider = provider;
					if (!draft.model.trim() || draft.model === getDefaultModel(previousProvider)) {
						draft.model = getDefaultModel(provider);
					}
				}
				break;
			}
			case 'model': {
				const model = await promptForModel(draft.model, draft.provider);
				if (model !== undefined) {
					draft.model = model.trim();
				}
				break;
			}
			case 'baseUrl': {
				const baseUrl = await promptForBaseUrl(draft.baseUrl || '');
				if (baseUrl !== undefined) {
					draft.baseUrl = baseUrl.trim();
				}
				break;
			}
			case 'apiKey': {
				const apiKey = await promptForApiKey(draft.apiKey);
				if (apiKey !== undefined) {
					draft.apiKey = apiKey.trim();
				}
				break;
			}
			case 'test': {
				const validationError = validateProfileDraft(draft);
				if (validationError) {
					vscode.window.showWarningMessage(validationError);
					break;
				}

				try {
					const config = resolveAIConfigFromProfile(draft);
					await testAIConfigConnection(config);
					showOutputChannel(true);
					vscode.window.showInformationMessage(`模型连接测试成功: ${draft.name} / ${config.model}`);
				} catch (error) {
					logError('测试草稿配置失败:', error);
					showOutputChannel(true);
					vscode.window.showErrorMessage(`测试草稿配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
				}
				break;
			}
			case 'save': {
				const validationError = validateProfileDraft(draft);
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

async function promptForProfile(profile?: AIProfile): Promise<AIProfile | undefined> {
	const draftProfile: AIProfile = profile || {
		id: createProfileId(),
		name: `配置 ${getProviderProfilesState().profiles.length + 1}`,
		provider: 'openai',
		model: getDefaultModel('openai'),
		apiKey: '',
		baseUrl: ''
	};

	return editProfileDraft(draftProfile, !profile);
}

async function revealProfile(profileId: string): Promise<void> {
	if (!providerManagementTreeView || !providerManagementDataProvider || !profileId) {
		return;
	}

	const target = providerManagementDataProvider.getItemById(profileId);
	if (!target) {
		return;
	}

	await providerManagementTreeView.reveal(target, {
		select: true,
		focus: false,
		expand: true
	});
}

async function handleAddProfile(): Promise<void> {
	const profile = await promptForProfile();
	if (!profile) {
		return;
	}

	const state = getProviderProfilesState();
	await saveProfiles({
		profiles: [...state.profiles, profile],
		activeProfileId: state.activeProfileId || profile.id
	});
	await revealProfile(profile.id);
	vscode.window.showInformationMessage(`已新增 AI 配置：${profile.name}`);
}

async function handleEditProfile(itemOrProfileId?: ProviderProfileTreeItem | string): Promise<void> {
	const profileId = typeof itemOrProfileId === 'string' ? itemOrProfileId : itemOrProfileId?.profile.id;
	const existingProfile = profileId ? getProviderProfileById(profileId) : undefined;

	if (!existingProfile) {
		throw new Error('找不到要编辑的配置');
	}

	const updatedProfile = await promptForProfile(existingProfile);
	if (!updatedProfile) {
		return;
	}

	const state = getProviderProfilesState();
	await saveProfiles({
		profiles: state.profiles.map(profile => profile.id === updatedProfile.id ? updatedProfile : profile),
		activeProfileId: state.activeProfileId
	});
	await revealProfile(updatedProfile.id);
	vscode.window.showInformationMessage(`已更新 AI 配置：${updatedProfile.name}`);
}

async function handleDeleteProfile(itemOrProfileId?: ProviderProfileTreeItem | string): Promise<void> {
	const profileId = typeof itemOrProfileId === 'string' ? itemOrProfileId : itemOrProfileId?.profile.id;
	const profile = profileId ? getProviderProfileById(profileId) : undefined;

	if (!profile) {
		throw new Error('找不到要删除的配置');
	}

	const confirmed = await vscode.window.showWarningMessage(
		`确定删除 AI 配置“${profile.name}”吗？`,
		{ modal: true },
		'删除'
	);
	if (confirmed !== '删除') {
		return;
	}

	const state = getProviderProfilesState();
	const nextProfiles = state.profiles.filter(item => item.id !== profile.id);
	const nextActiveProfileId = state.activeProfileId === profile.id ? nextProfiles[0]?.id || '' : state.activeProfileId;
	await saveProfiles({
		profiles: nextProfiles,
		activeProfileId: nextActiveProfileId
	});
	if (nextActiveProfileId) {
		await revealProfile(nextActiveProfileId);
	}
	vscode.window.showInformationMessage(`已删除 AI 配置：${profile.name}`);
}

async function handleActivateProfile(itemOrProfileId?: ProviderProfileTreeItem | string): Promise<void> {
	const profileId = typeof itemOrProfileId === 'string' ? itemOrProfileId : itemOrProfileId?.profile.id;
	const profile = profileId ? getProviderProfileById(profileId) : undefined;

	if (!profile) {
		throw new Error('找不到要激活的配置');
	}

	const state = getProviderProfilesState();
	await saveProfiles({
		profiles: state.profiles,
		activeProfileId: profile.id
	});
	await revealProfile(profile.id);
	vscode.window.showInformationMessage(`当前激活配置已切换为：${profile.name}`);
}

async function handleTestProfile(itemOrProfileId?: ProviderProfileTreeItem | string): Promise<void> {
	const profileId = typeof itemOrProfileId === 'string' ? itemOrProfileId : itemOrProfileId?.profile.id;
	const profile = profileId ? getProviderProfileById(profileId) : undefined;

	if (!profile) {
		throw new Error('找不到要测试的配置');
	}

	const config = resolveAIConfigFromProfile(profile);
	await testAIConfigConnection(config);
	showOutputChannel(true);
	vscode.window.showInformationMessage(`模型连接测试成功: ${profile.name} / ${config.model}`, '查看输出').then(selection => {
		if (selection === '查看输出') {
			showOutputChannel(true);
		}
	});
}

export function registerProviderManagementPanel(context: vscode.ExtensionContext): void {
	providerManagementDataProvider = new ProviderManagementTreeDataProvider();
	providerManagementTreeView = vscode.window.createTreeView(PROVIDER_MANAGEMENT_VIEW_ID, {
		treeDataProvider: providerManagementDataProvider,
		showCollapseAll: false,
		canSelectMany: false,
		dragAndDropController: new ProviderProfilesDragAndDropController()
	});
	updateProviderManagementViewMetadata();

	context.subscriptions.push(providerManagementTreeView);
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (!event.affectsConfiguration(PROVIDER_PROFILES_CONFIGURATION_KEY)
			&& !event.affectsConfiguration(ACTIVE_PROVIDER_PROFILE_ID_CONFIGURATION_KEY)) {
			return;
		}

		providerManagementDataProvider?.refresh();
	}));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_PROVIDER_PROFILE_COMMAND, async () => {
		try {
			await handleAddProfile();
		} catch (error) {
			logError('新增 AI 配置失败:', error);
			vscode.window.showErrorMessage(`新增 AI 配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(EDIT_PROVIDER_PROFILE_COMMAND, async (item?: ProviderProfileTreeItem) => {
		try {
			await handleEditProfile(item);
		} catch (error) {
			logError('编辑 AI 配置失败:', error);
			vscode.window.showErrorMessage(`编辑 AI 配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(DELETE_PROVIDER_PROFILE_COMMAND, async (item?: ProviderProfileTreeItem) => {
		try {
			await handleDeleteProfile(item);
		} catch (error) {
			logError('删除 AI 配置失败:', error);
			vscode.window.showErrorMessage(`删除 AI 配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(ACTIVATE_PROVIDER_PROFILE_COMMAND, async (item?: ProviderProfileTreeItem) => {
		try {
			await handleActivateProfile(item);
		} catch (error) {
			logError('切换激活 AI 配置失败:', error);
			vscode.window.showErrorMessage(`切换激活 AI 配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand(REFRESH_PROVIDER_PROFILES_COMMAND, () => {
		providerManagementDataProvider?.refresh();
	}));
}

export function openProviderManagementPanel(): void {
	void vscode.commands.executeCommand(`workbench.view.extension.${PROVIDER_MANAGEMENT_VIEW_CONTAINER_ID}`).then(async () => {
		const activeProfileId = getProviderProfilesState().activeProfileId;
		if (activeProfileId) {
			await revealProfile(activeProfileId);
		}
	});
}

export async function testProviderProfileById(profileId: string): Promise<void> {
	await handleTestProfile(profileId);
}
