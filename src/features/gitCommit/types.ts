export type AIProvider = 'openai' | 'openai-response' | 'claude' | 'gemini';

export interface AIProfile {
	id: string;
	name: string;
	provider: AIProvider;
	apiKey: string;
	model: string;
	baseUrl?: string;
}

export interface ProviderProfilesState {
	activeProfileId: string;
	profiles: AIProfile[];
}

export interface AIConfig {
	profileId: string;
	profileName: string;
	provider: AIProvider;
	apiKey: string;
	model: string;
	baseUrl?: string;
}

export interface AIRequestOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
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
