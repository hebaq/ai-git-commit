export type AIProvider = 'openai' | 'openai-response' | 'claude' | 'gemini';

export interface AIConfig {
	provider: AIProvider;
	apiKey: string;
	model: string;
	baseUrl?: string;
}

export interface DiffSummary {
	modifiedFiles: string[];
	addedLines: number;
	removedLines: number;
	scopeHints: string[];
	hasBreakingChange: boolean;
	hasDocsOnlyChanges: boolean;
	hasTestsOnlyChanges: boolean;
	hasConfigChanges: boolean;
	hasConfigOnlyChanges: boolean;
	hasCiChanges: boolean;
	hasCiOnlyChanges: boolean;
}
