import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { appendOutputLine, logInfo } from '../gitCommit/output';
import { DEPLOYMENT_EXPORT_FILE_EXTENSION } from './constants';
import {
	getDeploymentServersState,
	hasWorkspaceScope,
	getWorkspaceDeploymentTargets,
	updateDeploymentServers
} from './config';
import { updateWorkspaceDeploymentTargets } from './config';
import {
	applyDeploymentSecretSnapshot,
	deleteDeploymentSecrets,
	getDeploymentSecretSnapshot
} from './secretStorage';
import type { DeploymentSecretSnapshot, DeploymentServerProfile, DeploymentWorkspaceTarget } from './types';

interface XTerminalGroup {
	_id?: string;
	name?: string;
	parentId?: string;
}

interface XTerminalServer {
	_id?: string;
	title?: string;
	host?: string;
	port?: number;
	username?: string;
	authType?: string;
	password?: string;
	privateKey?: string;
	groupId?: string;
	parentId?: string;
	note?: string;
}

interface XTerminalExportFile {
	groups?: XTerminalGroup[];
	servers?: XTerminalServer[];
}

interface DeploymentExportPayload {
	version: 1;
	exportedAt: string;
	globalServers: DeploymentServerProfile[];
	workspaceServers: DeploymentServerProfile[];
	workspaceDeploymentTargets: DeploymentWorkspaceTarget[];
	secrets: Record<string, DeploymentSecretSnapshot>;
}

interface EncryptedDeploymentExportFile {
	version: 1;
	algorithm: 'aes-256-gcm';
	kdf: 'scrypt';
	salt: string;
	iv: string;
	authTag: string;
	ciphertext: string;
}

type ImportMode = 'replace' | 'merge';
type GenericImportFormat = 'encrypted-export' | 'xterminal';

function normalizeGroupPath(groupPath: string): string | undefined {
	const normalized = groupPath
		.split(/[\\/]+/)
		.map(segment => segment.trim())
		.filter(Boolean)
		.join('/');

	return normalized || undefined;
	}

function bufferToBase64(value: Buffer): string {
	return value.toString('base64');
}

function base64ToBuffer(value: string): Buffer {
	return Buffer.from(value, 'base64');
}

function deriveEncryptionKey(passphrase: string, salt: Buffer): Buffer {
	return crypto.scryptSync(passphrase, salt, 32);
}

function encryptPayload(payload: DeploymentExportPayload, passphrase: string): EncryptedDeploymentExportFile {
	const salt = crypto.randomBytes(16);
	const iv = crypto.randomBytes(12);
	const key = deriveEncryptionKey(passphrase, salt);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return {
		version: 1,
		algorithm: 'aes-256-gcm',
		kdf: 'scrypt',
		salt: bufferToBase64(salt),
		iv: bufferToBase64(iv),
		authTag: bufferToBase64(authTag),
		ciphertext: bufferToBase64(ciphertext)
	};
	}

function decryptPayload(fileContent: string, passphrase: string): DeploymentExportPayload {
	const parsed = JSON.parse(fileContent) as Partial<EncryptedDeploymentExportFile>;
	if (
		parsed.version !== 1
		|| parsed.algorithm !== 'aes-256-gcm'
		|| parsed.kdf !== 'scrypt'
		|| typeof parsed.salt !== 'string'
		|| typeof parsed.iv !== 'string'
		|| typeof parsed.authTag !== 'string'
		|| typeof parsed.ciphertext !== 'string'
	) {
		throw new Error('不是受支持的部署配置导出文件');
	}

	const salt = base64ToBuffer(parsed.salt);
	const iv = base64ToBuffer(parsed.iv);
	const authTag = base64ToBuffer(parsed.authTag);
	const ciphertext = base64ToBuffer(parsed.ciphertext);
	const key = deriveEncryptionKey(passphrase, salt);
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);
	const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	const payload = JSON.parse(plaintext) as Partial<DeploymentExportPayload>;

	if (
		payload.version !== 1
		|| !Array.isArray(payload.globalServers)
		|| !Array.isArray(payload.workspaceServers)
		|| !Array.isArray(payload.workspaceDeploymentTargets)
		|| !payload.secrets
		|| typeof payload.secrets !== 'object'
	) {
		throw new Error('部署配置导出文件内容无效');
	}

	return payload as DeploymentExportPayload;
	}

function detectImportFormat(fileContent: string): GenericImportFormat {
	const parsed = JSON.parse(fileContent) as Partial<EncryptedDeploymentExportFile & XTerminalExportFile>;

	if (
		parsed.version === 1
		&& parsed.algorithm === 'aes-256-gcm'
		&& parsed.kdf === 'scrypt'
		&& typeof parsed.ciphertext === 'string'
	) {
		return 'encrypted-export';
	}

	if (Array.isArray(parsed.servers)) {
		return 'xterminal';
	}

	throw new Error('不是受支持的导入文件格式');
	}

async function promptForPassphrase(mode: 'export' | 'import'): Promise<string | undefined> {
	const passphrase = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		password: true,
		prompt: mode === 'export' ? '输入导出文件加密口令' : '输入导入文件解密口令',
		placeHolder: '至少 8 位'
	});
	if (passphrase === undefined) {
		return undefined;
	}

	if (passphrase.trim().length < 8) {
		vscode.window.showWarningMessage('加密口令至少需要 8 位');
		return undefined;
	}

	if (mode === 'import') {
		return passphrase;
	}

	const confirmPassphrase = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		password: true,
		prompt: '再次输入导出文件加密口令',
		placeHolder: '用于确认'
	});
	if (confirmPassphrase === undefined) {
		return undefined;
	}

	if (confirmPassphrase !== passphrase) {
		vscode.window.showWarningMessage('两次输入的加密口令不一致');
		return undefined;
	}

	return passphrase;
	}

async function promptForImportMode(): Promise<ImportMode | undefined> {
	const selected = await vscode.window.showQuickPick([
		{ label: '替换当前部署配置', description: '清空当前范围内已有服务器后导入', mode: 'replace' as const },
		{ label: '合并部署配置', description: '按服务器 ID 覆盖同名项，其余保留', mode: 'merge' as const }
	], {
		ignoreFocusOut: true,
		placeHolder: '选择导入模式'
	});

	return selected?.mode;
	}

async function promptForExternalImportScope(): Promise<'global' | 'workspace' | undefined> {
	const items = [
		{ label: '导入到全局服务器', description: '适合复用型服务器配置，推荐', scope: 'global' as const },
		...(hasWorkspaceScope() ? [{ label: '导入到当前工作区', description: '仅当前项目可见', scope: 'workspace' as const }] : [])
	];
	const selected = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder: '选择外部终端配置要导入到哪里'
	});

	return selected?.scope;
	}

function buildXTerminalGroupPathMap(groups: XTerminalGroup[]): Map<string, string> {
	const groupById = new Map(groups.filter(group => typeof group._id === 'string' && group._id).map(group => [group._id as string, group]));
	const resolved = new Map<string, string>();

	function resolvePath(groupId: string, visited = new Set<string>()): string | undefined {
		if (resolved.has(groupId)) {
			return resolved.get(groupId);
		}

		if (visited.has(groupId)) {
			return undefined;
		}

		visited.add(groupId);
		const group = groupById.get(groupId);
		if (!group || typeof group.name !== 'string' || !group.name.trim()) {
			return undefined;
		}

		const parentPath = group.parentId ? resolvePath(group.parentId, visited) : undefined;
		const nextPath = normalizeGroupPath(parentPath ? `${parentPath}/${group.name.trim()}` : group.name.trim());
		if (nextPath) {
			resolved.set(groupId, nextPath);
		}

		return nextPath;
	}

	for (const groupId of groupById.keys()) {
		resolvePath(groupId);
	}

	return resolved;
	}

function convertXTerminalAuthType(authType?: string): DeploymentServerProfile['authType'] {
	if (authType === 'password') {
		return 'password';
	}

	if (authType === 'privateKey') {
		return 'privateKey';
	}

	return 'system';
	}

function createImportedServerId(rawId: string | undefined, index: number): string {
	return rawId && rawId.trim() ? `xterminal-${rawId.trim()}` : `xterminal-server-${Date.now()}-${index + 1}`;
	}

function parseXTerminalPayload(fileContent: string): {
	servers: DeploymentServerProfile[];
	secrets: Record<string, DeploymentSecretSnapshot>;
} {
	const parsed = JSON.parse(fileContent) as XTerminalExportFile;
	const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
	const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
	const groupPathMap = buildXTerminalGroupPathMap(groups);
	const importedServers: DeploymentServerProfile[] = [];
	const secrets: Record<string, DeploymentSecretSnapshot> = {};

	servers.forEach((server, index) => {
		const host = typeof server.host === 'string' ? server.host.trim() : '';
		const username = typeof server.username === 'string' ? server.username.trim() : '';
		if (!host || !username) {
			return;
		}

		const id = createImportedServerId(server._id, index);
		const authType = convertXTerminalAuthType(server.authType);
		const groupPath = typeof server.groupId === 'string'
			? groupPathMap.get(server.groupId)
			: typeof server.parentId === 'string'
				? groupPathMap.get(server.parentId)
				: undefined;

		importedServers.push({
			id,
			name: typeof server.title === 'string' && server.title.trim() ? server.title.trim() : host,
			groupPath,
			note: typeof server.note === 'string' && server.note.trim() ? server.note.trim() : undefined,
			host,
			port: typeof server.port === 'number' && server.port > 0 ? server.port : 22,
			username,
			authType,
			remoteRoot: '',
			actions: [],
			secretEnvKeys: []
		});

		secrets[id] = {
			env: {},
			password: typeof server.password === 'string' && server.password.trim() ? server.password : undefined,
			privateKey: typeof server.privateKey === 'string' && server.privateKey.trim() ? server.privateKey : undefined
		};
	});

	return { servers: importedServers, secrets };
	}

function mergeServers(currentServers: DeploymentServerProfile[], importedServers: DeploymentServerProfile[]): DeploymentServerProfile[] {
	const importedById = new Map(importedServers.map(server => [server.id, server]));
	const merged = currentServers.map(server => importedById.get(server.id) || server);
	const mergedIds = new Set(merged.map(server => server.id));

	for (const importedServer of importedServers) {
		if (!mergedIds.has(importedServer.id)) {
			merged.push(importedServer);
		}
	}

	return merged;
}
async function collectSecrets(servers: DeploymentServerProfile[]): Promise<Record<string, DeploymentSecretSnapshot>> {
	const secrets: Record<string, DeploymentSecretSnapshot> = {};

	for (const server of servers) {
		secrets[server.id] = await getDeploymentSecretSnapshot(server);
	}

	return secrets;
	}

export async function exportDeploymentConfiguration(): Promise<void> {
	const passphrase = await promptForPassphrase('export');
	if (!passphrase) {
		return;
	}

	const targetUri = await vscode.window.showSaveDialog({
		saveLabel: '导出部署配置',
		filters: {
			'Hebai Deployment Export': [DEPLOYMENT_EXPORT_FILE_EXTENSION]
		},
		defaultUri: vscode.Uri.file(`hebai-deployment.${DEPLOYMENT_EXPORT_FILE_EXTENSION}`)
	});
	if (!targetUri) {
		return;
	}

	const state = getDeploymentServersState();
	const payload: DeploymentExportPayload = {
		version: 1,
		exportedAt: new Date().toISOString(),
		globalServers: state.globalServers,
		workspaceServers: state.workspaceServers,
		workspaceDeploymentTargets: getWorkspaceDeploymentTargets(),
		secrets: {
			...(await collectSecrets(state.globalServers)),
			...(await collectSecrets(state.workspaceServers))
		}
	};
	const encrypted = encryptPayload(payload, passphrase);
	await vscode.workspace.fs.writeFile(targetUri, Buffer.from(JSON.stringify(encrypted, null, 2), 'utf8'));
	appendOutputLine(`已导出部署配置: ${targetUri.fsPath}`);
	logInfo(`部署配置导出成功，共 ${payload.globalServers.length + payload.workspaceServers.length} 台服务器`);
	vscode.window.showInformationMessage(`部署配置已导出：${targetUri.fsPath}`);
	}

export async function importDeploymentConfiguration(): Promise<void> {
	const fileUris = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		openLabel: '导入部署配置',
		filters: {
			'JSON Files': ['json']
		}
	});
	if (!fileUris || fileUris.length === 0) {
		return;
	}

	const fileBuffer = await vscode.workspace.fs.readFile(fileUris[0]);
	const fileContent = Buffer.from(fileBuffer).toString('utf8');
	const format = detectImportFormat(fileContent);
	const mode = await promptForImportMode();
	if (!mode) {
		return;
	}

	if (format === 'encrypted-export') {
		const passphrase = await promptForPassphrase('import');
		if (!passphrase) {
			return;
		}

		let payload: DeploymentExportPayload;
		try {
			payload = decryptPayload(fileContent, passphrase);
		} catch (error) {
			throw new Error(`导入失败，可能是口令错误或文件已损坏: ${error instanceof Error ? error.message : '未知错误'}`);
		}

		const currentState = getDeploymentServersState();
		const nextGlobalServers = mode === 'replace'
			? payload.globalServers
			: mergeServers(currentState.globalServers, payload.globalServers);
		const canImportWorkspaceServers = hasWorkspaceScope();
		const nextWorkspaceServers = !canImportWorkspaceServers
			? currentState.workspaceServers
			: mode === 'replace'
				? payload.workspaceServers
				: mergeServers(currentState.workspaceServers, payload.workspaceServers);

		if (mode === 'replace') {
			for (const server of currentState.globalServers) {
				await deleteDeploymentSecrets(server.id, server.secretEnvKeys);
			}
			if (canImportWorkspaceServers) {
				for (const server of currentState.workspaceServers) {
					await deleteDeploymentSecrets(server.id, server.secretEnvKeys);
				}
			}
		}

		await updateDeploymentServers('global', nextGlobalServers);
		if (canImportWorkspaceServers) {
			await updateDeploymentServers('workspace', nextWorkspaceServers);
			await updateWorkspaceDeploymentTargets(payload.workspaceDeploymentTargets);
		}

		for (const server of nextGlobalServers) {
			const snapshot = payload.secrets[server.id];
			if (snapshot) {
				await applyDeploymentSecretSnapshot(server.id, snapshot);
			}
		}
		if (canImportWorkspaceServers) {
			for (const server of nextWorkspaceServers) {
				const snapshot = payload.secrets[server.id];
				if (snapshot) {
					await applyDeploymentSecretSnapshot(server.id, snapshot);
				}
			}
		}

		appendOutputLine(`已导入部署配置: ${fileUris[0].fsPath}`);
		logInfo(`部署配置导入成功，共 ${payload.globalServers.length + (canImportWorkspaceServers ? payload.workspaceServers.length : 0)} 台服务器`);
		if (!canImportWorkspaceServers && payload.workspaceServers.length > 0) {
			vscode.window.showWarningMessage('当前没有打开工作区，只导入了全局部署配置；工作区级配置已跳过');
			return;
		}

		vscode.window.showInformationMessage(`部署配置导入成功：${fileUris[0].fsPath}`);
		return;
	}

	const xterminalPayload = parseXTerminalPayload(fileContent);
	const targetScope = await promptForExternalImportScope();
	if (!targetScope) {
		return;
	}

	const currentState = getDeploymentServersState();
	const currentServers = targetScope === 'global' ? currentState.globalServers : currentState.workspaceServers;
	const nextServers = mode === 'replace'
		? xterminalPayload.servers
		: mergeServers(currentServers, xterminalPayload.servers);

	if (mode === 'replace') {
		for (const server of currentServers) {
			await deleteDeploymentSecrets(server.id, server.secretEnvKeys);
		}
	}

	await updateDeploymentServers(targetScope, nextServers);
	if (targetScope === 'workspace') {
		await updateWorkspaceDeploymentTargets([]);
	}

	for (const server of nextServers) {
		const snapshot = xterminalPayload.secrets[server.id];
		if (snapshot) {
			await applyDeploymentSecretSnapshot(server.id, snapshot);
		}
	}

	appendOutputLine(`已导入 xterminal 配置: ${fileUris[0].fsPath}`);
	logInfo(`xterminal 配置导入成功，共 ${xterminalPayload.servers.length} 台服务器，范围：${targetScope === 'global' ? '全局' : '工作区'}`);
	vscode.window.showInformationMessage(`xterminal 配置导入成功：${xterminalPayload.servers.length} 台服务器`);
	}