import * as cp from 'child_process';

import * as vscode from 'vscode';
import { promisify } from 'util';

const exec = promisify(cp.exec);

export function getWorkspacePath(): string {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		console.log('没有找到工作区文件夹');
		throw new Error('请在 Git 仓库中打开项目');
	}

	return workspaceFolder.uri.fsPath;
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

export async function setCommitMessage(message: string): Promise<void> {
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		return;
	}

	const git = gitExtension.getAPI(1);
	if (git.repositories.length === 0) {
		return;
	}

	git.repositories[0].inputBox.value = message;
}
