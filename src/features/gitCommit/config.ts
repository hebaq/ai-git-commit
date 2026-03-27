import * as vscode from 'vscode';

import { ACTIVE_PROVIDER_PROFILE_ID_SETTING, CONFIG_NAMESPACE, PROVIDER_PROFILES_SETTING } from './constants';
import { logDebug } from './output';
import type { AIConfig, AIProfile, AIProvider, ProviderProfilesState } from './types';

export function getDefaultModel(provider: AIProvider): string {
	switch (provider) {
		case 'openai':
		case 'openai-response':
			return 'gpt-5.4';
		case 'claude':
			return 'claude-sonnet-4.5';
		case 'gemini':
			return 'gemini-3-flash-preview';
		default:
			return 'gpt-5.4';
	}
}

function getEnvApiKey(provider: AIProvider): string {
	switch (provider) {
		case 'openai':
		case 'openai-response':
			return process.env.OPENAI_API_KEY || '';
		case 'claude':
			return process.env.CLAUDE_API_KEY || '';
		case 'gemini':
			return process.env.GEMINI_API_KEY || '';
		default:
			return '';
	}
}

function getEnvModel(provider: AIProvider): string {
	switch (provider) {
		case 'openai':
		case 'openai-response':
			return process.env.OPENAI_MODEL || '';
		case 'claude':
			return process.env.CLAUDE_MODEL || '';
		case 'gemini':
			return process.env.GEMINI_MODEL || '';
		default:
			return '';
	}
}

function getEnvBaseUrl(provider: AIProvider): string {
	const genericBaseUrl = process.env.AI_BASE_URL || '';
	if (genericBaseUrl) {
		return genericBaseUrl;
	}

	switch (provider) {
		case 'openai':
		case 'openai-response':
			return process.env.OPENAI_BASE_URL || '';
		case 'claude':
			return process.env.CLAUDE_BASE_URL || '';
		case 'gemini':
			return process.env.GEMINI_BASE_URL || '';
		default:
			return '';
	}
}

function isAIProvider(value: unknown): value is AIProvider {
	return value === 'openai' || value === 'openai-response' || value === 'claude' || value === 'gemini';
}

function normalizeProfile(rawProfile: unknown, index: number): AIProfile | null {
	if (!rawProfile || typeof rawProfile !== 'object') {
		return null;
	}

	const candidate = rawProfile as Partial<Record<keyof AIProfile, unknown>>;
	const provider = isAIProvider(candidate.provider) ? candidate.provider : 'openai';
	const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `profile-${index + 1}`;
	const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : `配置 ${index + 1}`;
	const apiKey = typeof candidate.apiKey === 'string' ? candidate.apiKey : '';
	const model = typeof candidate.model === 'string' ? candidate.model : '';
	const baseUrl = typeof candidate.baseUrl === 'string' && candidate.baseUrl.trim() ? candidate.baseUrl.trim() : undefined;

	return {
		id,
		name,
		provider,
		apiKey,
		model,
		baseUrl
	};
}

export function resolveAIConfigFromProfile(profile: AIProfile): AIConfig {
	const envApiKey = getEnvApiKey(profile.provider);
	const envModel = getEnvModel(profile.provider);
	const envBaseUrl = getEnvBaseUrl(profile.provider);
	const model = envModel || profile.model || getDefaultModel(profile.provider);

	return {
		profileId: profile.id,
		profileName: profile.name,
		provider: profile.provider,
		apiKey: profile.apiKey || envApiKey,
		model,
		baseUrl: profile.baseUrl || envBaseUrl || undefined
	};
}

export function getProviderProfilesState(): ProviderProfilesState {
	const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
	const rawProfiles = config.get<unknown[]>(PROVIDER_PROFILES_SETTING, []);
	const profiles = rawProfiles
		.map((profile, index) => normalizeProfile(profile, index))
		.filter((profile): profile is AIProfile => profile !== null);
	const configuredActiveProfileId = config.get<string>(ACTIVE_PROVIDER_PROFILE_ID_SETTING, '') || '';
	const activeProfileExists = profiles.some(profile => profile.id === configuredActiveProfileId);

	return {
		profiles,
		activeProfileId: activeProfileExists ? configuredActiveProfileId : profiles[0]?.id || ''
	};
}

export function getProviderProfileById(profileId: string): AIProfile | undefined {
	if (!profileId) {
		return undefined;
	}

	return getProviderProfilesState().profiles.find(profile => profile.id === profileId);
}

export async function updateProviderProfilesState(state: ProviderProfilesState): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
	const profiles = state.profiles.map(profile => ({
		id: profile.id,
		name: profile.name,
		provider: profile.provider,
		apiKey: profile.apiKey,
		model: profile.model,
		baseUrl: profile.baseUrl || ''
	}));
	const activeProfileId = profiles.some(profile => profile.id === state.activeProfileId) ? state.activeProfileId : profiles[0]?.id || '';

	await Promise.all([
		config.update(PROVIDER_PROFILES_SETTING, profiles, vscode.ConfigurationTarget.Global),
		config.update(ACTIVE_PROVIDER_PROFILE_ID_SETTING, activeProfileId, vscode.ConfigurationTarget.Global)
	]);
}

export function getAIConfig(): AIConfig {
	const { profiles, activeProfileId } = getProviderProfilesState();
	const activeProfile = profiles.find(profile => profile.id === activeProfileId);

	logDebug('=== 配置读取调试 ===');

	if (!activeProfile) {
		throw new Error('请先打开 AI 配置管理页，新增并激活一个模型配置');
	};

	logDebug(`Active profile: ${activeProfile.name}`);
	logDebug(`Provider: ${activeProfile.provider}`);

	return resolveAIConfigFromProfile(activeProfile);
}
