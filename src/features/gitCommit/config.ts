import * as vscode from 'vscode';

import { CONFIG_NAMESPACE } from './constants';
import { logDebug } from './output';
import type { AIConfig, AIProvider } from './types';

function getDefaultModel(provider: AIProvider): string {
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

export function getAIConfig(): AIConfig {
	const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
	const provider = config.get('aiProvider', 'openai') as AIProvider;

	logDebug('=== 配置读取调试 ===');
	logDebug(`Provider: ${provider}`);

	const envApiKey = getEnvApiKey(provider);
	const envModel = getEnvModel(provider);
	const envBaseUrl = getEnvBaseUrl(provider);
	const configuredModel = config.get('model', '');
	const model = envModel || configuredModel || getDefaultModel(provider);

	return {
		provider,
		apiKey: config.get('apiKey', '') || envApiKey,
		model,
		baseUrl: config.get('baseUrl', '') || envBaseUrl || undefined
	};
}
