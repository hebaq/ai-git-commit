import { generateAIText } from './aiProviders';
import { TEST_MODEL_PROMPT } from './constants';
import { logInfo } from './output';
import type { AIConfig } from './types';

export function ensureModelTestConfig(config: AIConfig): void {
	if (!config.apiKey) {
		throw new Error('请先配置 API Key');
	}

	if (!config.model) {
		throw new Error('请先配置模型名称');
	}
}

export async function testAIConfigConnection(config: AIConfig): Promise<string> {
	ensureModelTestConfig(config);

	logInfo(`开始测试模型连接: profile=${config.profileName}, provider=${config.provider}, model=${config.model}`);
	const response = await generateAIText(TEST_MODEL_PROMPT, config);
	const normalizedResponse = response.replace(/\s+/g, ' ').trim();

	if (!normalizedResponse) {
		throw new Error('模型已返回成功响应，但内容为空');
	}

	logInfo(`测试提示词: ${TEST_MODEL_PROMPT}`);
	logInfo('测试模型连接成功');
	logInfo(`模型返回: ${response}`);

	return response;
}