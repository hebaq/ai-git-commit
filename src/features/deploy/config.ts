import * as vscode from 'vscode';

import { CONFIG_NAMESPACE } from '../gitCommit/constants';
import {
	DEPLOYMENT_DEFAULT_TIMEOUT_SECONDS,
	DEPLOYMENT_GLOBAL_SERVERS_SETTING,
	DEPLOYMENT_WORKSPACE_TARGETS_SETTING,
	DEPLOYMENT_WORKSPACE_SERVERS_SETTING
} from './constants';
import type {
	DeploymentAction,
	DeploymentAuthType,
	DeploymentScope,
	DeploymentServerProfile,
	DeploymentServersState,
	DeploymentWorkspaceTarget,
	ScopedDeploymentServer
} from './types';

function cloneAction(action: DeploymentAction): DeploymentAction {
	return { ...action };
}

function normalizeWorkspaceDeploymentTarget(rawTarget: unknown, index: number): DeploymentWorkspaceTarget | null {
	if (!rawTarget || typeof rawTarget !== 'object') {
		return null;
	}

	const candidate = rawTarget as Partial<Record<keyof DeploymentWorkspaceTarget, unknown>>;
	const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `workspace-target-${index + 1}`;
	const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : `部署目标 ${index + 1}`;
	const serverId = typeof candidate.serverId === 'string' ? candidate.serverId.trim() : '';
	const remoteRoot = typeof candidate.remoteRoot === 'string' ? candidate.remoteRoot.trim() : '';
	const defaultActionId = typeof candidate.defaultActionId === 'string' && candidate.defaultActionId.trim()
		? candidate.defaultActionId.trim()
		: undefined;
	const actions = Array.isArray(candidate.actions)
		? candidate.actions
			.map((action, actionIndex) => normalizeAction(action, actionIndex))
			.filter((action): action is DeploymentAction => action !== null)
		: [];

	if (!serverId) {
		return null;
	}

	return {
		id,
		name,
		serverId,
		remoteRoot,
		actions,
		defaultActionId: defaultActionId && actions.some(action => action.id === defaultActionId) ? defaultActionId : undefined
	};
}

function normalizeWorkspaceDeploymentTargets(rawTargets: unknown): DeploymentWorkspaceTarget[] {
	if (!Array.isArray(rawTargets)) {
		return [];
	}

	return rawTargets
		.map((target, index) => normalizeWorkspaceDeploymentTarget(target, index))
		.filter((target): target is DeploymentWorkspaceTarget => target !== null);
}

function isDeploymentAuthType(value: unknown): value is DeploymentAuthType {
		return value === 'system' || value === 'password' || value === 'privateKey';
}

	function normalizeGroupPath(rawGroupPath: unknown): string | undefined {
		if (typeof rawGroupPath !== 'string') {
			return undefined;
		}

		const normalized = rawGroupPath
			.split(/[\\/]+/)
			.map(segment => segment.trim())
			.filter(Boolean)
			.join('/');

		return normalized || undefined;
		}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const seen = new Set<string>();
	const normalized: string[] = [];

	for (const item of value) {
		if (typeof item !== 'string') {
			continue;
		}

		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}

		seen.add(trimmed);
		normalized.push(trimmed);
	}

	return normalized;
}

function normalizeAction(rawAction: unknown, index: number): DeploymentAction | null {
	if (!rawAction || typeof rawAction !== 'object') {
		return null;
	}

	const candidate = rawAction as Partial<Record<keyof DeploymentAction, unknown>>;
	const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `action-${index + 1}`;
	const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : `动作 ${index + 1}`;
	const command = typeof candidate.command === 'string' ? candidate.command.trim() : '';
	const confirm = typeof candidate.confirm === 'boolean' ? candidate.confirm : true;
	const timeoutCandidate = typeof candidate.timeoutSeconds === 'number' ? candidate.timeoutSeconds : Number(candidate.timeoutSeconds);
	const timeoutSeconds = Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
		? Math.round(timeoutCandidate)
		: DEPLOYMENT_DEFAULT_TIMEOUT_SECONDS;

	if (!command) {
		return null;
	}

	return {
		id,
		name,
		command,
		confirm,
		timeoutSeconds
	};
}

function normalizeServer(rawServer: unknown, index: number): DeploymentServerProfile | null {
	if (!rawServer || typeof rawServer !== 'object') {
		return null;
	}

	const candidate = rawServer as Partial<Record<keyof DeploymentServerProfile, unknown>>;
	const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `server-${index + 1}`;
	const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : `服务器 ${index + 1}`;
	const groupPath = normalizeGroupPath(candidate.groupPath);
	const note = typeof candidate.note === 'string' && candidate.note.trim() ? candidate.note.trim() : undefined;
	const host = typeof candidate.host === 'string' ? candidate.host.trim() : '';
	const username = typeof candidate.username === 'string' ? candidate.username.trim() : '';
	const authType = isDeploymentAuthType(candidate.authType) ? candidate.authType : 'system';
	const remoteRoot = typeof candidate.remoteRoot === 'string' ? candidate.remoteRoot.trim() : '';
	const portCandidate = typeof candidate.port === 'number' ? candidate.port : Number(candidate.port);
	const port = Number.isFinite(portCandidate) && portCandidate > 0 ? Math.round(portCandidate) : 22;
	const actions = Array.isArray(candidate.actions)
		? candidate.actions
			.map((action, actionIndex) => normalizeAction(action, actionIndex))
			.filter((action): action is DeploymentAction => action !== null)
		: [];
	const secretEnvKeys = normalizeStringList(candidate.secretEnvKeys);

	if (!host || !username) {
		return null;
	}

	return {
		id,
		name,
		groupPath,
		note,
		host,
		port,
		username,
		authType,
		remoteRoot,
		actions,
		secretEnvKeys
	};
	}

function normalizeServers(rawServers: unknown): DeploymentServerProfile[] {
	if (!Array.isArray(rawServers)) {
		return [];
	}

	return rawServers
		.map((server, index) => normalizeServer(server, index))
		.filter((server): server is DeploymentServerProfile => server !== null);
}

function getInspectedServerLists(): DeploymentServersState {
	const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
	const globalInspection = config.inspect<unknown[]>(DEPLOYMENT_GLOBAL_SERVERS_SETTING);
	const workspaceInspection = config.inspect<unknown[]>(DEPLOYMENT_WORKSPACE_SERVERS_SETTING);

	return {
		globalServers: normalizeServers(globalInspection?.globalValue),
		workspaceServers: normalizeServers(workspaceInspection?.workspaceValue)
	};
}

export function hasWorkspaceScope(): boolean {
	return Boolean(vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length);
}

export function getDeploymentServersState(): DeploymentServersState {
	return getInspectedServerLists();
}

export function getDeploymentServerGroups(): Array<{ scope: DeploymentScope; servers: DeploymentServerProfile[] }> {
	const state = getDeploymentServersState();
	const groups: Array<{ scope: DeploymentScope; servers: DeploymentServerProfile[] }> = [
		{ scope: 'global', servers: state.globalServers }
	];

	if (hasWorkspaceScope()) {
		groups.push({ scope: 'workspace', servers: state.workspaceServers });
	}

	return groups;
}

export function getAllDeploymentServers(): ScopedDeploymentServer[] {
	const state = getDeploymentServersState();

	return [
		...state.globalServers.map(server => ({ ...server, scope: 'global' as const })),
		...state.workspaceServers.map(server => ({ ...server, scope: 'workspace' as const }))
	];
}

export function getDeploymentServerById(serverId: string): ScopedDeploymentServer | undefined {
	if (!serverId) {
		return undefined;
	}

	return getAllDeploymentServers().find(server => server.id === serverId);
}

export function getWorkspaceDeploymentTargets(): DeploymentWorkspaceTarget[] {
	if (!hasWorkspaceScope()) {
		return [];
	}

	const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
	const inspection = config.inspect<unknown[]>(DEPLOYMENT_WORKSPACE_TARGETS_SETTING);
	return normalizeWorkspaceDeploymentTargets(inspection?.workspaceValue);
}

export function getWorkspaceDeploymentTargetById(targetId: string): DeploymentWorkspaceTarget | undefined {
	if (!targetId) {
		return undefined;
	}

	return getWorkspaceDeploymentTargets().find(target => target.id === targetId);
}

export function resolveWorkspaceDeploymentTarget(targetId: string): {
	target: DeploymentWorkspaceTarget;
	server: ScopedDeploymentServer;
	remoteRoot: string;
	actions: DeploymentAction[];
	defaultAction?: DeploymentAction;
} | undefined {
	const workspaceTarget = getWorkspaceDeploymentTargetById(targetId);
	if (!workspaceTarget) {
		return undefined;
	}

	const server = getDeploymentServerById(workspaceTarget.serverId);
	if (!server) {
		return undefined;
	}

	const defaultAction = workspaceTarget.defaultActionId
		? workspaceTarget.actions.find(item => item.id === workspaceTarget.defaultActionId)
		: undefined;

	return {
		target: {
			...workspaceTarget,
			actions: workspaceTarget.actions.map(cloneAction)
		},
		server,
		remoteRoot: workspaceTarget.remoteRoot,
		actions: workspaceTarget.actions.map(cloneAction),
		defaultAction: defaultAction ? cloneAction(defaultAction) : undefined
	};
}

export async function updateWorkspaceDeploymentTargets(targets: DeploymentWorkspaceTarget[]): Promise<void> {
	if (!hasWorkspaceScope()) {
		throw new Error('当前没有打开工作区，无法保存工作区部署目标');
	}

	const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
	const persistedValue = targets.map(target => ({
		id: target.id,
		name: target.name,
		serverId: target.serverId,
		remoteRoot: target.remoteRoot,
		actions: target.actions.map(action => ({
			id: action.id,
			name: action.name,
			command: action.command,
			confirm: action.confirm,
			timeoutSeconds: action.timeoutSeconds
		})),
		defaultActionId: target.defaultActionId || ''
	}));
	await config.update(DEPLOYMENT_WORKSPACE_TARGETS_SETTING, persistedValue, vscode.ConfigurationTarget.Workspace);
}

export async function updateDeploymentServers(scope: DeploymentScope, servers: DeploymentServerProfile[]): Promise<void> {
	if (scope === 'workspace' && !hasWorkspaceScope()) {
		throw new Error('当前没有打开工作区，无法保存工作区级部署配置');
	}

	const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
	const setting = scope === 'global' ? DEPLOYMENT_GLOBAL_SERVERS_SETTING : DEPLOYMENT_WORKSPACE_SERVERS_SETTING;
	const target = scope === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
	const persistedServers = servers.map(server => ({
		id: server.id,
		name: server.name,
		groupPath: server.groupPath || '',
		note: server.note || '',
		host: server.host,
		port: server.port,
		username: server.username,
		authType: server.authType,
		remoteRoot: server.remoteRoot,
		actions: server.actions.map(action => ({
			id: action.id,
			name: action.name,
			command: action.command,
			confirm: action.confirm,
			timeoutSeconds: action.timeoutSeconds
		})),
		secretEnvKeys: [...server.secretEnvKeys]
	}));

	await config.update(setting, persistedServers, target);
}