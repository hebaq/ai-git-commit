import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { getDeploymentServerPassword, getDeploymentServerPrivateKey } from './secretStorage';
import type { DeploymentServerProfile } from './types';

const trackedTerminalKeyFiles = new Map<vscode.Terminal, string>();

function quotePowerShell(value: string): string {
	return `'${value.replace(/'/g, `''`)}'`;
}

async function createTemporaryPrivateKeyFile(server: DeploymentServerProfile, privateKey: string): Promise<string> {
	const filePath = path.join(os.tmpdir(), `hebai-deploy-${server.id}-${Date.now()}.key`);
	await fs.writeFile(filePath, privateKey, { encoding: 'utf8' });
	try {
		await fs.chmod(filePath, 0o600);
	} catch {
		// Windows 下 chmod 可能不生效，忽略即可。
	}

	return filePath;
}

export function registerDeploymentTerminalCleanup(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
		const keyFilePath = trackedTerminalKeyFiles.get(terminal);
		if (!keyFilePath) {
			return;
		}

		trackedTerminalKeyFiles.delete(terminal);
		void fs.rm(keyFilePath, { force: true });
	}));

	context.subscriptions.push({
		dispose: () => {
			for (const keyFilePath of trackedTerminalKeyFiles.values()) {
				void fs.rm(keyFilePath, { force: true });
			}
			trackedTerminalKeyFiles.clear();
		}
	});
}

export async function openDeploymentServerTerminal(server: DeploymentServerProfile): Promise<void> {
	const terminal = vscode.window.createTerminal(`SSH ${server.name}`);
	const sshArgs = ['ssh', '-p', String(server.port)];
	let informationalMessage: string | undefined;

	if (server.authType === 'privateKey') {
		const privateKey = await getDeploymentServerPrivateKey(server.id);
		if (privateKey) {
			const privateKeyPath = await createTemporaryPrivateKeyFile(server, privateKey);
			trackedTerminalKeyFiles.set(terminal, privateKeyPath);
			sshArgs.push('-i', quotePowerShell(privateKeyPath));
			informationalMessage = '已为当前终端临时写入私钥文件，关闭终端后会自动清理。';
		} else {
			informationalMessage = '未找到已保存的私钥，终端已打开；如果本机未配置对应私钥，SSH 登录可能失败。';
		}
	} else if (server.authType === 'password') {
		const password = await getDeploymentServerPassword(server.id);
		if (password) {
			await vscode.env.clipboard.writeText(password);
			informationalMessage = '已将已保存的 SSH 密码写入剪贴板，请在终端提示时直接粘贴。';
		} else {
			informationalMessage = '未找到已保存的 SSH 密码，终端已打开；请手动输入密码。';
		}
	}

	sshArgs.push(`${server.username}@${server.host}`);
	terminal.show(true);
	terminal.sendText(sshArgs.join(' '), true);

	if (informationalMessage) {
		vscode.window.showInformationMessage(informationalMessage);
	}
}