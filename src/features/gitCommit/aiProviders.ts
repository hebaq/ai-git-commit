import axios from 'axios';
import OpenAI from 'openai';

import { cleanCommitMessage } from './cleanCommitMessage';
import { AI_REQUEST_TIMEOUT_MS, AI_RESPONSE_MAX_TOKENS, AI_RESPONSE_TEMPERATURE } from './constants';
import { logDebug } from './output';
import { buildPrompt } from './prompt';
import type { AIConfig, AIProvider, AIRequestOptions } from './types';
import type { GitCommitEntry } from './git';

interface ProviderAdapter {
	generateText(prompt: string, config: AIConfig, options: AIRequestOptions): Promise<string>;
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/$/, '');
}

function createOpenAIClient(config: AIConfig): OpenAI {
	const clientConfig: ConstructorParameters<typeof OpenAI>[0] = {
		apiKey: config.apiKey,
		maxRetries: 0,
		timeout: AI_REQUEST_TIMEOUT_MS
	};

	switch (config.provider) {
		case 'openai':
		case 'openai-response':
			if (config.baseUrl) {
				clientConfig.baseURL = normalizeBaseUrl(config.baseUrl);
				logDebug(`使用自定义 OpenAI Base URL: ${clientConfig.baseURL}`);
			}
			break;
		default:
			break;
	}

	return new OpenAI(clientConfig);
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
			return provider;
	}
}

function getTimeoutMs(options: AIRequestOptions): number {
	return options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
}

function buildOpenAIRequestOptions(options: AIRequestOptions): {
	timeout: number;
} {
	return {
		timeout: getTimeoutMs(options)
	};
}

function createAbortPromise(signal?: AbortSignal): Promise<never> | undefined {
	if (!signal) {
		return undefined;
	}

	if (signal.aborted) {
		return Promise.reject(new Error('AbortError'));
	}

	return new Promise((_, reject) => {
		signal.addEventListener('abort', () => {
			reject(new Error('AbortError'));
		}, { once: true });
	});
}

async function runWithCancellation<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
	const abortPromise = createAbortPromise(signal);
	if (!abortPromise) {
		return task;
	}

	return Promise.race([task, abortPromise]);
}

function formatProviderError(provider: AIProvider, error: unknown): Error {
	const providerLabel = getProviderLabel(provider);

	if (optionsLikeAbortError(error)) {
		return new Error(`${providerLabel} 请求已取消`);
	}

	if (axios.isAxiosError(error)) {
		if (error.code === 'ECONNABORTED') {
			return new Error(`${providerLabel} 请求超时，请检查网络或基础地址配置`);
		}

		const status = error.response?.status;
		if (status === 401 || status === 403) {
			return new Error(`${providerLabel} 鉴权失败，请检查 API Key 或访问权限`);
		}

		if (status === 429) {
			return new Error(`${providerLabel} 请求过于频繁或额度不足，请稍后重试`);
		}

		if (status === 404) {
			return new Error(`${providerLabel} 接口不存在，请检查基础地址、模型名称或接口兼容性`);
		}

		if (status && status >= 500) {
			return new Error(`${providerLabel} 服务暂时不可用，请稍后重试`);
		}

		return new Error(`${providerLabel} 请求失败: ${error.message}`);
	}

	if (error instanceof Error) {
		if (error.name === 'AbortError') {
			return new Error(`${providerLabel} 请求已取消`);
		}

		if (error.name === 'APIConnectionTimeoutError') {
			return new Error(`${providerLabel} 请求超时，请检查网络或基础地址配置`);
		}

		if (typeof (error as Error & { status?: number; }).status === 'number') {
			const status = (error as Error & { status?: number; }).status;
			if (status === 401 || status === 403) {
				return new Error(`${providerLabel} 鉴权失败，请检查 API Key 或访问权限`);
			}

			if (status === 429) {
				return new Error(`${providerLabel} 请求过于频繁或额度不足，请稍后重试`);
			}
		}

		if (error.message) {
			return new Error(`${providerLabel} 请求失败: ${error.message}`);
		}
	}

	return new Error(`${providerLabel} 请求失败: 未知错误`);
}

function optionsLikeAbortError(error: unknown): boolean {
	if (!error) {
		return false;
	}

	if (axios.isCancel(error)) {
		return true;
	}

	if (error instanceof Error) {
		return error.name === 'AbortError' || error.message === 'canceled';
	}

	return false;
}

function logRawMessage(rawMessage: string): void {
	const preview = rawMessage.length > 1_000 ? `${rawMessage.slice(0, 1_000)}... [已截断 ${rawMessage.length - 1_000} 字符]` : rawMessage;
	logDebug(`AI 原始返回: ${preview}`);
}

async function callWithOpenAISDK(prompt: string, config: AIConfig, options: AIRequestOptions): Promise<string> {
	const client = createOpenAIClient(config);
	const response = await runWithCancellation(client.chat.completions.create({
		model: config.model,
		messages: [
			{
				role: 'user',
				content: prompt
			}
		],
		max_tokens: AI_RESPONSE_MAX_TOKENS,
		temperature: AI_RESPONSE_TEMPERATURE
	}, buildOpenAIRequestOptions(options)), options.signal);

	const rawMessage = response.choices[0].message.content?.trim() || '';
	logRawMessage(rawMessage);
	return rawMessage;
}

async function callWithOpenAIResponsesAPI(prompt: string, config: AIConfig, options: AIRequestOptions): Promise<string> {
	const client = createOpenAIClient(config);
	const response = await runWithCancellation(client.responses.create({
		model: config.model,
		input: prompt
	}, buildOpenAIRequestOptions(options)), options.signal);

	const rawMessage = response.output_text?.trim() || '';
	logRawMessage(rawMessage);
	return rawMessage;
}

async function callClaude(prompt: string, config: AIConfig, options: AIRequestOptions): Promise<string> {
	const baseUrl = normalizeBaseUrl(config.baseUrl || 'https://api.anthropic.com');
	const apiEndpoint = `${baseUrl}/v1/messages`;

	logDebug(`Claude API 端点: ${apiEndpoint}`);

	const response = await axios.post(apiEndpoint, {
		model: config.model,
		max_tokens: AI_RESPONSE_MAX_TOKENS,
		temperature: AI_RESPONSE_TEMPERATURE,
		messages: [
			{
				role: 'user',
				content: prompt
			}
		]
	}, {
		timeout: getTimeoutMs(options),
		signal: options.signal,
		headers: {
			'x-api-key': config.apiKey,
			'Content-Type': 'application/json',
			'anthropic-version': '2023-06-01'
		}
	});

	const rawMessage = response.data.content[0].text.trim();
	logRawMessage(rawMessage);
	return rawMessage;
}

async function callGemini(prompt: string, config: AIConfig, options: AIRequestOptions): Promise<string> {
	const baseUrl = normalizeBaseUrl(config.baseUrl || 'https://generativelanguage.googleapis.com');
	const response = await axios.post(`${baseUrl}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`, {
		contents: [
			{
				parts: [
					{
						text: prompt
					}
				]
			}
		],
		generationConfig: {
			maxOutputTokens: AI_RESPONSE_MAX_TOKENS,
			temperature: AI_RESPONSE_TEMPERATURE
		}
	}, {
		timeout: getTimeoutMs(options),
		signal: options.signal,
		headers: {
			'Content-Type': 'application/json'
		}
	});

	const rawMessage = response.data.candidates[0].content.parts[0].text.trim();
	logRawMessage(rawMessage);
	return rawMessage;
}

const providerAdapters: Record<AIProvider, ProviderAdapter> = {
	openai: {
		generateText(prompt: string, config: AIConfig, options: AIRequestOptions) {
			return callWithOpenAISDK(prompt, config, options);
		}
	},
	'openai-response': {
		generateText(prompt: string, config: AIConfig, options: AIRequestOptions) {
			return callWithOpenAIResponsesAPI(prompt, config, options);
		}
	},
	claude: {
		generateText(prompt: string, config: AIConfig, options: AIRequestOptions) {
			return callClaude(prompt, config, options);
		}
	},
	gemini: {
		generateText(prompt: string, config: AIConfig, options: AIRequestOptions) {
			return callGemini(prompt, config, options);
		}
	}
};

export async function generateAIText(prompt: string, config: AIConfig, options: AIRequestOptions = {}): Promise<string> {
	const adapter = providerAdapters[config.provider];
	if (!adapter) {
		throw new Error(`不支持的 AI 提供商: ${config.provider}`);
	}

	try {
		return await adapter.generateText(prompt, config, options);
	} catch (error) {
		throw formatProviderError(config.provider, error);
	}
}

export async function generateAICommitMessage(diffOutput: string, recentCommits: GitCommitEntry[], config: AIConfig, options: AIRequestOptions = {}): Promise<string> {
	const prompt = buildPrompt(diffOutput, recentCommits, config);
	const rawMessage = await generateAIText(prompt, config, options);
	return cleanCommitMessage(rawMessage);
}
