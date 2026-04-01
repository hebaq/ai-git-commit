import * as cp from 'child_process';
import * as path from 'path';

import * as vscode from 'vscode';
import { promisify } from 'util';

import { logDebug, logError } from './output';

const exec = promisify(cp.exec);
const execFile = promisify(cp.execFile);

interface GitRepository {
	rootUri: vscode.Uri;
	inputBox: {
		value: string;
	};
}

interface GitApi {
	repositories: GitRepository[];
}

export interface GitRepositoryContext {
	repository: GitRepository;
	workspacePath: string;
}

export interface GitFileHistoryEntry {
	commitHash: string;
	shortHash: string;
	authorName: string;
	commitDate: string;
	subject: string;
	patch: string;
}

function getGitApi(): GitApi {
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		logError('未检测到 VS Code Git 扩展');
		throw new Error('未检测到 VS Code Git 扩展');
	}

	return gitExtension.getAPI(1) as GitApi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toUri(value: unknown): vscode.Uri | undefined {
	if (value instanceof vscode.Uri) {
		return value;
	}

	if (!isRecord(value)) {
		return undefined;
	}

	if (typeof value.scheme === 'string' && typeof value.path === 'string') {
		return vscode.Uri.from({
			scheme: value.scheme,
			authority: typeof value.authority === 'string' ? value.authority : '',
			path: value.path,
			query: typeof value.query === 'string' ? value.query : '',
			fragment: typeof value.fragment === 'string' ? value.fragment : ''
		});
	}

	if (typeof value.fsPath === 'string') {
		return vscode.Uri.file(value.fsPath);
	}

	return undefined;
}

function normalizePath(filePath: string): string {
	const resolvedPath = path.resolve(filePath);
	return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function isPathInsideRepository(repositoryPath: string, targetPath: string): boolean {
	const normalizedRepositoryPath = normalizePath(repositoryPath);
	const normalizedTargetPath = normalizePath(targetPath);

	return normalizedTargetPath === normalizedRepositoryPath
		|| normalizedTargetPath.startsWith(`${normalizedRepositoryPath}${path.sep}`);
}

function collectUriCandidates(value: unknown, visited = new Set<object>()): vscode.Uri[] {
	if (Array.isArray(value)) {
		return value.flatMap(item => collectUriCandidates(item, visited));
	}

	const directUri = toUri(value);
	if (directUri) {
		return [directUri];
	}

	if (!isRecord(value)) {
		return [];
	}

	if (visited.has(value)) {
		return [];
	}

	visited.add(value);

	const candidates: vscode.Uri[] = [];
	for (const key of ['rootUri', 'resourceUri', 'uri']) {
		const candidateUri = toUri(value[key]);
		if (candidateUri) {
			candidates.push(candidateUri);
		}
	}

	for (const key of ['sourceControl', 'resourceGroup', 'resourceState', 'repository']) {
		if (key in value) {
			candidates.push(...collectUriCandidates(value[key], visited));
		}
	}

	return candidates;
}

function findRepositoryByUri(repositories: GitRepository[], uri: vscode.Uri): GitRepository | undefined {
	if (!uri.fsPath) {
		return undefined;
	}

	let matchedRepository: GitRepository | undefined;
	let longestMatchLength = -1;

	for (const repository of repositories) {
		const repositoryPath = repository.rootUri.fsPath;
		if (!isPathInsideRepository(repositoryPath, uri.fsPath)) {
			continue;
		}

		const matchLength = normalizePath(repositoryPath).length;
		if (matchLength > longestMatchLength) {
			longestMatchLength = matchLength;
			matchedRepository = repository;
		}
	}

	return matchedRepository;
}

function getRepositoryLabel(repository: GitRepository): string {
	return path.basename(repository.rootUri.fsPath) || repository.rootUri.fsPath;
}

function parseFileHistoryLog(output: string): GitFileHistoryEntry[] {
	return output
		.split('\x1e')
		.map(entry => entry.trim())
		.filter(Boolean)
		.map(entry => {
			const newlineIndex = entry.indexOf('\n');
			const header = newlineIndex >= 0 ? entry.slice(0, newlineIndex) : entry;
			const patch = newlineIndex >= 0 ? entry.slice(newlineIndex + 1).trimEnd() : '';
			const [commitHash, shortHash, authorName, commitDate, subject] = header.split('\x1f');

			return {
				commitHash,
				shortHash,
				authorName,
				commitDate,
				subject,
				patch
			};
		});
}

export function getGitRelativePath(workspacePath: string, filePath: string): string {
	const relativePath = path.relative(workspacePath, filePath);
	if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		throw new Error('所选文件不在当前 Git 仓库中');
	}

	return relativePath.split(path.sep).join('/');
}

async function promptForRepository(repositories: GitRepository[]): Promise<GitRepository> {
	if (repositories.length === 1) {
		return repositories[0];
	}

	const items = repositories.map(repository => {
		const label = getRepositoryLabel(repository);
		const relativePath = vscode.workspace.asRelativePath(repository.rootUri, false);

		return {
			label,
			description: relativePath && relativePath !== label ? relativePath : repository.rootUri.fsPath,
			repository
		};
	});

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: '选择要生成提交信息的 Git 仓库'
	});

	if (!selected) {
		throw new Error('未选择 Git 仓库');
	}

	return selected.repository;
}

export async function resolveGitRepository(commandContext?: unknown): Promise<GitRepositoryContext> {
	const git = getGitApi();
	const repositories = git.repositories;

	if (repositories.length === 0) {
		throw new Error('没有检测到 Git 仓库');
	}

	for (const candidateUri of collectUriCandidates(commandContext)) {
		const matchedRepository = findRepositoryByUri(repositories, candidateUri);
		if (matchedRepository) {
			logDebug(`根据命令上下文匹配 Git 仓库: ${matchedRepository.rootUri.fsPath}`);
			return {
				repository: matchedRepository,
				workspacePath: matchedRepository.rootUri.fsPath
			};
		}
	}

	const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
	if (activeEditorUri) {
		const matchedRepository = findRepositoryByUri(repositories, activeEditorUri);
		if (matchedRepository) {
			logDebug(`根据活动编辑器匹配 Git 仓库: ${matchedRepository.rootUri.fsPath}`);
			return {
				repository: matchedRepository,
				workspacePath: matchedRepository.rootUri.fsPath
			};
		}
	}

	const selectedRepository = await promptForRepository(repositories);
	logDebug(`根据手动选择匹配 Git 仓库: ${selectedRepository.rootUri.fsPath}`);

	return {
		repository: selectedRepository,
		workspacePath: selectedRepository.rootUri.fsPath
	};
}

export async function ensureGitRepository(workspacePath: string): Promise<void> {
	try {
		await exec('git status', { cwd: workspacePath });
	} catch {
		throw new Error('当前目录不是 Git 仓库');
	}
}

export async function getDiffForCommitMessage(workspacePath: string): Promise<string> {
	const { stdout: stagedDiff } = await exec('git diff --cached', { cwd: workspacePath });
	if (stagedDiff.trim()) {
		return stagedDiff;
	}

	const { stdout: workingDiff } = await exec('git diff', { cwd: workspacePath });
	if (!workingDiff.trim()) {
		throw new Error('没有检测到代码变更，请先修改代码并使用 git add 暂存更改');
	}

	throw new Error('检测到工作区有变更，请使用 git add 暂存更改后再生成提交信息');
}

export async function getFileHistory(workspacePath: string, filePath: string, maxEntries = 100): Promise<GitFileHistoryEntry[]> {
	const gitRelativePath = getGitRelativePath(workspacePath, filePath);
	logDebug(`开始读取文件历史: ${gitRelativePath}`);

	const { stdout } = await execFile('git', [
		'log',
		'--follow',
		`--max-count=${maxEntries}`,
		'--date=short',
		'--format=%x1e%H%x1f%h%x1f%an%x1f%ad%x1f%s',
		'-p',
		'--',
		gitRelativePath
	], {
		cwd: workspacePath,
		maxBuffer: 50 * 1024 * 1024
	});

	return parseFileHistoryLog(stdout);
}

export async function setCommitMessage(message: string, repository: GitRepository): Promise<void> {
	repository.inputBox.value = message;
}
