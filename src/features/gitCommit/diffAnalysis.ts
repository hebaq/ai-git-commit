import type { DiffSummary } from './types';

const GENERIC_SCOPE_SEGMENTS = new Set([
	'src',
	'lib',
	'app',
	'apps',
	'packages',
	'package',
	'modules',
	'module',
	'components',
	'component',
	'tests',
	'test',
	'__tests__',
	'docs',
	'doc',
	'dist',
	'build',
	'config',
	'configs',
	'resources',
	'resource',
	'public',
	'scripts',
	'github',
	'workflow',
	'workflows',
	'types',
	'shared',
	'common'
]);

function normalizeScopeSegment(segment: string): string {
	return segment
		.replace(/\.[^.]+$/, '')
		.toLowerCase()
		.replace(/[_\s]+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function isDocumentationPath(filePath: string): boolean {
	return /(^|\/)(docs?|readme|changelog|license)(\/|\.|$)/.test(filePath);
}

function isTestPath(filePath: string): boolean {
	return /(^|\/)(__tests__|tests?)(\/|$)|\.(test|spec)\./.test(filePath);
}

function isConfigPath(filePath: string): boolean {
	return /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig(?:\..+)?\.json|webpack\.config\..+|vite\.config\..+|rollup\.config\..+|eslint(?:\.config)?\..+|prettier(?:\.config)?\..+|babel\.config\..+|jest\.config\..+|vitest\.config\..+)$|(^|\/)(config|configs)\//.test(filePath);
}

function isCiPath(filePath: string): boolean {
	return /(^|\/)\.github\/workflows\/|(^|\/)(azure-pipelines|jenkinsfile|dockerfile|docker-compose|\.gitlab-ci)/.test(filePath);
}

function deriveScopeHints(modifiedFiles: string[]): string[] {
	const scopeCounts = new Map<string, number>();

	for (const filePath of modifiedFiles) {
		const segments = filePath.split('/').filter(Boolean).map(normalizeScopeSegment).filter(Boolean);
		if (segments.length === 0) {
			continue;
		}

		const directorySegments = segments.slice(0, -1).filter(segment => !GENERIC_SCOPE_SEGMENTS.has(segment));
		const fileScope = segments[segments.length - 1];
		const scope = directorySegments[0] || (fileScope && !GENERIC_SCOPE_SEGMENTS.has(fileScope) ? fileScope : '');

		if (!scope) {
			continue;
		}

		scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
	}

	return Array.from(scopeCounts.entries())
		.sort((left, right) => right[1] - left[1])
		.slice(0, 3)
		.map(([scope]) => scope);
}

export function analyzeDiffSummary(diffOutput: string): DiffSummary {
	const lines = diffOutput.split('\n');
	const modifiedFiles: string[] = [];
	const seenFiles = new Set<string>();
	let addedLines = 0;
	let removedLines = 0;

	for (const line of lines) {
		if (line.startsWith('diff --git')) {
			const match = line.match(/diff --git a\/(.*?) b\/(.*?)$/);
			const filePath = match?.[2] || match?.[1];

			if (filePath && !seenFiles.has(filePath)) {
				seenFiles.add(filePath);
				modifiedFiles.push(filePath);
			}

			continue;
		}

		if (line.startsWith('+++') || line.startsWith('---')) {
			continue;
		}

		if (line.startsWith('+')) {
			addedLines++;
			continue;
		}

		if (line.startsWith('-')) {
			removedLines++;
		}
	}

	const normalizedFiles = modifiedFiles.map(filePath => filePath.toLowerCase());
	const hasDocsOnlyChanges = normalizedFiles.length > 0 && normalizedFiles.every(isDocumentationPath);
	const hasTestsOnlyChanges = normalizedFiles.length > 0 && normalizedFiles.every(isTestPath);
	const hasConfigChanges = normalizedFiles.some(isConfigPath);
	const hasConfigOnlyChanges = normalizedFiles.length > 0 && normalizedFiles.every(isConfigPath);
	const hasCiChanges = normalizedFiles.some(isCiPath);
	const hasCiOnlyChanges = normalizedFiles.length > 0 && normalizedFiles.every(isCiPath);

	return {
		modifiedFiles,
		addedLines,
		removedLines,
		scopeHints: deriveScopeHints(modifiedFiles),
		hasBreakingChange: /BREAKING CHANGE|breaking change|deprecated|remove(?:d)?\s+(?:public|api|endpoint|option|config)|rename(?:d)?\s+(?:public|api|option|config)|drop(?:ped)?\s+(?:support|compatibility)/i.test(diffOutput),
		hasDocsOnlyChanges,
		hasTestsOnlyChanges,
		hasConfigChanges,
		hasConfigOnlyChanges,
		hasCiChanges,
		hasCiOnlyChanges
	};
}
