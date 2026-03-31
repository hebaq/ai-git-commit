import * as vscode from 'vscode';

import { CONFIG_NAMESPACE } from '../gitCommit/constants';
import type {
	DeploymentPrivateKeyDraft,
	DeploymentPasswordDraft,
	DeploymentSecretEnvDraft,
	DeploymentSecretSnapshot,
	DeploymentServerProfile
} from './types';

let secretStorage: vscode.SecretStorage | undefined;

function getSecretStorage(): vscode.SecretStorage {
	if (!secretStorage) {
		throw new Error('部署密钥存储尚未初始化');
	}

	return secretStorage;
}

function buildSecretStorageKey(serverId: string, envKey: string): string {
	return `${CONFIG_NAMESPACE}.deploy.${serverId}.secret.${envKey}`;
}

function buildPasswordStorageKey(serverId: string): string {
	return `${CONFIG_NAMESPACE}.deploy.${serverId}.password`;
}

function buildPrivateKeyStorageKey(serverId: string): string {
	return `${CONFIG_NAMESPACE}.deploy.${serverId}.privateKey`;
	}

export function initializeDeploymentSecretStorage(context: vscode.ExtensionContext): void {
	secretStorage = context.secrets;
}

export async function getDeploymentSecretEnvDrafts(server: DeploymentServerProfile): Promise<DeploymentSecretEnvDraft[]> {
	const storage = getSecretStorage();
	const drafts: DeploymentSecretEnvDraft[] = [];

	for (const envKey of server.secretEnvKeys) {
		const storedValue = await storage.get(buildSecretStorageKey(server.id, envKey));
		drafts.push({
			key: envKey,
			value: '',
			hasStoredValue: Boolean(storedValue),
			originalKey: envKey
		});
	}

	return drafts;
}

export async function getDeploymentPasswordDraft(serverId: string): Promise<DeploymentPasswordDraft> {
	const storage = getSecretStorage();
	const storedPassword = await storage.get(buildPasswordStorageKey(serverId));

	return {
		value: '',
		hasStoredValue: Boolean(storedPassword)
	};
}

export async function getDeploymentPrivateKeyDraft(serverId: string): Promise<DeploymentPrivateKeyDraft> {
	const storage = getSecretStorage();
	const storedPrivateKey = await storage.get(buildPrivateKeyStorageKey(serverId));

	return {
		value: '',
		hasStoredValue: Boolean(storedPrivateKey)
	};
	}

export async function getDeploymentServerPassword(serverId: string): Promise<string | undefined> {
	return getSecretStorage().get(buildPasswordStorageKey(serverId));
}

export async function getDeploymentServerPrivateKey(serverId: string): Promise<string | undefined> {
	return getSecretStorage().get(buildPrivateKeyStorageKey(serverId));
	}

export async function getDeploymentSecretEnvValues(server: DeploymentServerProfile): Promise<Array<{ key: string; value: string }>> {
	const storage = getSecretStorage();
	const secretValues: Array<{ key: string; value: string }> = [];

	for (const envKey of server.secretEnvKeys) {
		const storedValue = await storage.get(buildSecretStorageKey(server.id, envKey));
		if (!storedValue) {
			continue;
		}

		secretValues.push({ key: envKey, value: storedValue });
	}

	return secretValues;
}

export async function saveDeploymentSecretEnvDrafts(
	serverId: string,
	previousKeys: string[],
	drafts: DeploymentSecretEnvDraft[]
): Promise<string[]> {
	const storage = getSecretStorage();
	const normalizedDrafts = drafts.filter(draft => draft.key.trim());
	const nextKeys = normalizedDrafts.map(draft => draft.key.trim());

	for (const previousKey of previousKeys) {
		if (nextKeys.includes(previousKey)) {
			continue;
		}

		await storage.delete(buildSecretStorageKey(serverId, previousKey));
	}

	for (const draft of normalizedDrafts) {
		const nextKey = draft.key.trim();
		const originalKey = draft.originalKey?.trim() || nextKey;
		const nextStorageKey = buildSecretStorageKey(serverId, nextKey);
		const originalStorageKey = buildSecretStorageKey(serverId, originalKey);
		const nextValue = draft.value.trim();

		if (nextValue) {
			await storage.store(nextStorageKey, nextValue);
		} else if (draft.hasStoredValue) {
			const originalValue = await storage.get(originalStorageKey);
			if (originalValue) {
				await storage.store(nextStorageKey, originalValue);
			} else {
				await storage.delete(nextStorageKey);
			}
		} else {
			await storage.delete(nextStorageKey);
		}

		if (originalKey !== nextKey) {
			await storage.delete(originalStorageKey);
		}
	}

	return nextKeys;
}

export async function saveDeploymentPasswordDraft(serverId: string, passwordDraft: DeploymentPasswordDraft): Promise<void> {
	const storage = getSecretStorage();
	const nextPassword = passwordDraft.value.trim();

	if (nextPassword) {
		await storage.store(buildPasswordStorageKey(serverId), nextPassword);
		return;
	}

	if (!passwordDraft.hasStoredValue) {
		await storage.delete(buildPasswordStorageKey(serverId));
	}
}

export async function saveDeploymentPrivateKeyDraft(serverId: string, privateKeyDraft: DeploymentPrivateKeyDraft): Promise<void> {
	const storage = getSecretStorage();
	const nextPrivateKey = privateKeyDraft.value.trim();

	if (nextPrivateKey) {
		await storage.store(buildPrivateKeyStorageKey(serverId), nextPrivateKey);
		return;
	}

	if (!privateKeyDraft.hasStoredValue) {
		await storage.delete(buildPrivateKeyStorageKey(serverId));
	}
	}

export async function getDeploymentSecretSnapshot(server: DeploymentServerProfile): Promise<DeploymentSecretSnapshot> {
	const envEntries = await getDeploymentSecretEnvValues(server);
	const password = await getDeploymentServerPassword(server.id);
	const privateKey = await getDeploymentServerPrivateKey(server.id);

	return {
		password,
		privateKey,
		env: Object.fromEntries(envEntries.map(entry => [entry.key, entry.value]))
	};
	}

export async function applyDeploymentSecretSnapshot(serverId: string, snapshot: DeploymentSecretSnapshot): Promise<void> {
	const storage = getSecretStorage();
	const envEntries = Object.entries(snapshot.env || {});

	for (const [envKey, envValue] of envEntries) {
		await storage.store(buildSecretStorageKey(serverId, envKey), envValue);
	}

	if (snapshot.password) {
		await storage.store(buildPasswordStorageKey(serverId), snapshot.password);
	} else {
		await storage.delete(buildPasswordStorageKey(serverId));
	}

	if (snapshot.privateKey) {
		await storage.store(buildPrivateKeyStorageKey(serverId), snapshot.privateKey);
	} else {
		await storage.delete(buildPrivateKeyStorageKey(serverId));
	}
}

export async function deleteDeploymentSecrets(serverId: string, keys: string[]): Promise<void> {
	const storage = getSecretStorage();

	for (const envKey of keys) {
		await storage.delete(buildSecretStorageKey(serverId, envKey));
	}

	await storage.delete(buildPasswordStorageKey(serverId));
	await storage.delete(buildPrivateKeyStorageKey(serverId));
}