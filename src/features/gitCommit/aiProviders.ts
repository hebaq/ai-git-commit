import axios from 'axios';
import OpenAI from 'openai';

import { cleanCommitMessage } from './cleanCommitMessage';
import { AI_RESPONSE_MAX_TOKENS, AI_RESPONSE_TEMPERATURE } from './constants';
import { logDebug } from './output';
import { buildPrompt } from './prompt';
import type { AIConfig } from './types';

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/$/, '');
}

function createOpenAIClient(config: AIConfig): OpenAI {
	const clientConfig: ConstructorParameters<typeof OpenAI>[0] = {
		apiKey: config.apiKey
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

async function callWithOpenAISDK(prompt: string, config: AIConfig): Promise<string> {
	const client = createOpenAIClient(config);
	const response = await client.chat.completions.create({
		model: config.model,
		messages: [
			{
				role: 'user',
				content: prompt
			}
		],
		max_tokens: AI_RESPONSE_MAX_TOKENS,
		temperature: AI_RESPONSE_TEMPERATURE
	});

	const rawMessage = response.choices[0].message.content?.trim() || '';
	logDebug(`AI 原始返回: ${rawMessage}`);
	return cleanCommitMessage(rawMessage);
}

async function callWithOpenAIResponsesAPI(prompt: string, config: AIConfig): Promise<string> {
	const client = createOpenAIClient(config);
	const response = await client.responses.create({
		model: config.model,
		input: prompt
	});

	const rawMessage = response.output_text?.trim() || '';
	logDebug(`AI 原始返回: ${rawMessage}`);
	return cleanCommitMessage(rawMessage);
}

async function callClaude(prompt: string, config: AIConfig): Promise<string> {
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
		headers: {
			'x-api-key': config.apiKey,
			'Content-Type': 'application/json',
			'anthropic-version': '2023-06-01'
		}
	});

	const rawMessage = response.data.content[0].text.trim();
	logDebug(`AI 原始返回: ${rawMessage}`);
	return cleanCommitMessage(rawMessage);
}

async function callGemini(prompt: string, config: AIConfig): Promise<string> {
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
		headers: {
			'Content-Type': 'application/json'
		}
	});

	const rawMessage = response.data.candidates[0].content.parts[0].text.trim();
	logDebug(`AI 原始返回: ${rawMessage}`);
	return cleanCommitMessage(rawMessage);
}

export async function generateAICommitMessage(diffOutput: string, config: AIConfig): Promise<string> {
	const prompt = buildPrompt(diffOutput, config);

	if (config.provider === 'openai') {
		return callWithOpenAISDK(prompt, config);
	}

	if (config.provider === 'openai-response') {
		return callWithOpenAIResponsesAPI(prompt, config);
	}

	switch (config.provider) {
		case 'claude':
			return callClaude(prompt, config);
		case 'gemini':
			return callGemini(prompt, config);
		default:
			throw new Error(`不支持的 AI 提供商: ${config.provider}`);
	}
}
