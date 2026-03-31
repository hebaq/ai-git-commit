import * as path from 'path';
import { spawn } from 'child_process';
import { Client } from 'ssh2';

import { appendOutput, appendOutputLine, logInfo, showOutputChannel } from '../gitCommit/output';
import { getDeploymentSecretEnvValues, getDeploymentServerPassword, getDeploymentServerPrivateKey } from './secretStorage';
import type { DeploymentAction, DeploymentServerProfile } from './types';

const runningServers = new Set<string>();

interface SshFailureDiagnosis {
	stage: string;
	summary: string;
	possibleCauses: string[];
	suggestions: string[];
}

interface DeploymentRuntimeSecretOverrides {
	password?: string;
	privateKey?: string;
	secretEnvValues?: Array<{ key: string; value: string }>;
}

function getAuthTypeLabel(server: DeploymentServerProfile): string {
	if (server.authType === 'password') {
		return '密码登录';
	}

	if (server.authType === 'privateKey') {
		return '私钥登录';
	}

	return '系统 SSH';
	}

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message || String(error);
	}

	if (typeof error === 'string') {
		return error;
	}

	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
	}

function createDisplayError(message: string): Error {
	const error = new Error(message);
	error.stack = '';
	return error;
	}

function diagnoseSshFailure(error: unknown): SshFailureDiagnosis {
	const message = normalizeErrorMessage(error);

	if (/before handshake|kex_exchange_identification|Connection closed by remote host/i.test(message)) {
		return {
			stage: 'SSH 握手前',
			summary: '远端在 SSH 握手前主动关闭了连接',
			possibleCauses: [
				'服务器 SSH 服务异常或未正常响应',
				'云防火墙、fail2ban 或安全策略拦截了当前来源 IP',
				'22 端口后面不是标准 SSH 服务，或前置代理/转发层直接断开了连接'
			],
			suggestions: [
				'在服务器上检查 sshd 日志，例如 auth.log、secure 或 journalctl -u sshd',
				'检查云厂商安全组、防火墙和 fail2ban 是否拦截当前机器',
				'用系统 ssh -vv 复现，确认是否同样在握手前断开'
			]
		};
	}

	if (/Permission denied|All configured authentication methods failed|authentication failed|Unable to authenticate/i.test(message)) {
		return {
			stage: '认证阶段',
			summary: 'SSH 握手已成功，但认证失败',
			possibleCauses: [
				'用户名、密码或私钥不正确',
				'目标服务器禁用了当前认证方式，例如不允许密码登录',
				'服务器要求额外认证策略，例如特定密钥算法或双因素限制'
			],
			suggestions: [
				'确认用户名和密码或私钥内容是否正确',
				'检查 sshd_config 中 PasswordAuthentication 或 PubkeyAuthentication 配置',
				'优先用系统 ssh 手工验证同一组凭证'
			]
		};
	}

	if (/timed out|timeout|ETIMEDOUT/i.test(message)) {
		return {
			stage: '连接建立阶段',
			summary: '连接超时，远端长时间没有完成响应',
			possibleCauses: [
				'网络链路不稳定或跨境网络抖动',
				'服务器负载过高，sshd 响应过慢',
				'防火墙静默丢弃连接，而不是直接拒绝'
			],
			suggestions: [
				'稍后重试，或在同网络环境下用系统 ssh 复现',
				'检查服务器负载和 sshd 响应时间',
				'必要时调高超时时间并检查链路质量'
			]
		};
	}

	if (/Connection refused|ECONNREFUSED/i.test(message)) {
		return {
			stage: 'TCP 建连阶段',
			summary: '目标主机拒绝了 22 端口连接',
			possibleCauses: [
				'服务器未启动 SSH 服务',
				'服务监听的不是当前端口',
				'防火墙或端口转发配置错误'
			],
			suggestions: [
				'确认 sshd 正在运行并监听正确端口',
				'核对服务器面板、安全组和端口映射配置'
			]
		};
	}

	if (/No route to host|EHOSTUNREACH|ENETUNREACH|getaddrinfo ENOTFOUND|ENOTFOUND/i.test(message)) {
		return {
			stage: '网络解析阶段',
			summary: '目标主机不可达或域名解析失败',
			possibleCauses: [
				'域名或 IP 地址填写错误',
				'本机 DNS 解析异常',
				'当前网络无法访问目标主机'
			],
			suggestions: [
				'检查服务器地址是否填写正确',
				'先用 ping、nslookup 或 Test-NetConnection 验证地址和端口',
				'确认当前网络出口允许访问目标主机'
			]
		};
	}

	if (/未找到 ssh 命令|ENOENT/i.test(message)) {
		return {
			stage: '本地执行阶段',
			summary: '本机没有可用的 SSH 客户端',
			possibleCauses: [
				'系统未安装 OpenSSH Client',
				'PATH 环境变量中没有 ssh 命令'
			],
			suggestions: [
				'在 Windows 可安装或启用 OpenSSH Client',
				'确认在终端中直接执行 ssh 命令是否可用'
			]
		};
	}

	return {
		stage: '未知阶段',
		summary: 'SSH 连接失败，但暂时无法自动归类',
		possibleCauses: [
			'可能是服务器侧限制、网络异常或凭证配置问题',
			'也可能是远端执行命令阶段返回了非预期错误'
		],
		suggestions: [
			'查看输出面板中的原始错误信息',
			'用系统 ssh 手工复现同一连接参数，进一步缩小范围'
		]
	};
	}

function appendSshDiagnosis(server: DeploymentServerProfile, actionLabel: string, error: unknown): string {
	const rawMessage = normalizeErrorMessage(error);
	const diagnosis = diagnoseSshFailure(error);

	appendOutputLine(`[诊断] ${actionLabel}失败`);
	appendOutputLine(`[诊断] 目标: ${server.username}@${server.host}:${server.port}`);
	appendOutputLine(`[诊断] 认证: ${getAuthTypeLabel(server)}`);
	appendOutputLine(`[诊断] 阶段: ${diagnosis.stage}`);
	appendOutputLine(`[诊断] 结论: ${diagnosis.summary}`);
	for (const cause of diagnosis.possibleCauses) {
		appendOutputLine(`[诊断] 可能原因: ${cause}`);
	}
	for (const suggestion of diagnosis.suggestions) {
		appendOutputLine(`[诊断] 建议: ${suggestion}`);
	}
	appendOutputLine(`[诊断] 原始错误: ${rawMessage}`);
	appendOutputLine('');

	return `${diagnosis.summary}。请查看输出面板中的诊断建议。`;
	}

function quotePosix(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRemoteCommand(
	server: DeploymentServerProfile,
	command: string,
	secretEnvValues: Array<{ key: string; value: string }>
): string {
	const exportCommands = secretEnvValues.map(secret => `export ${secret.key}=${quotePosix(secret.value)}`);
	const segments = [
		...exportCommands,
		server.remoteRoot ? `cd ${quotePosix(server.remoteRoot)}` : '',
		command.trim()
	].filter(Boolean);

	return segments.join(' && ');
}

async function runSshCommand(server: DeploymentServerProfile, remoteCommand: string, timeoutSeconds: number): Promise<void> {
	showOutputChannel(true);
	appendOutputLine(`$ ssh -o BatchMode=yes -p ${server.port} ${server.username}@${server.host} ${remoteCommand}`);

	await new Promise<void>((resolve, reject) => {
		let stderrOutput = '';
		const sshArgs = [
			'-o',
			'BatchMode=yes',
			'-o',
			`ConnectTimeout=${Math.max(5, Math.min(timeoutSeconds, 60))}`,
			'-p',
			String(server.port),
			`${server.username}@${server.host}`,
			remoteCommand
		];
		const childProcess = spawn('ssh', sshArgs, {
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const timeoutHandle = setTimeout(() => {
			childProcess.kill();
			reject(new Error(`SSH 命令执行超时（>${timeoutSeconds} 秒）`));
		}, timeoutSeconds * 1000);

		childProcess.stdout.on('data', chunk => {
			appendOutput(Buffer.from(chunk).toString('utf8'));
		});

		childProcess.stderr.on('data', chunk => {
			const output = Buffer.from(chunk).toString('utf8');
			stderrOutput += output;
			appendOutput(output);
		});

		childProcess.on('error', error => {
			clearTimeout(timeoutHandle);
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				reject(new Error('未找到 ssh 命令，请先安装并配置系统 OpenSSH 客户端'));
				return;
			}

			reject(error);
		});

		childProcess.on('close', code => {
			clearTimeout(timeoutHandle);
			if (code === 0) {
				appendOutputLine('');
				resolve();
				return;
			}

			const compactStderr = stderrOutput.trim();
			reject(new Error(compactStderr ? `SSH 命令执行失败: ${compactStderr}` : `SSH 命令执行失败，退出码: ${code ?? '未知'}`));
		});
	});
}

async function runPasswordSshCommand(
	server: DeploymentServerProfile,
	remoteCommand: string,
	timeoutSeconds: number,
	password: string
): Promise<void> {
	showOutputChannel(true);
	appendOutputLine(`$ ssh(password) ${server.username}@${server.host}:${server.port} ${remoteCommand}`);

	await new Promise<void>((resolve, reject) => {
		const client = new Client();
		let settled = false;
		const timeoutHandle = setTimeout(() => {
			if (settled) {
				return;
			}

			settled = true;
			client.end();
			reject(new Error(`SSH 命令执行超时（>${timeoutSeconds} 秒）`));
		}, timeoutSeconds * 1000);

		const finalize = (error?: Error) => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeoutHandle);
			client.end();
			if (error) {
				reject(error);
				return;
			}

			appendOutputLine('');
			resolve();
		};

		client.on('ready', () => {
			client.exec(remoteCommand, (error, stream) => {
				if (error) {
					finalize(error);
					return;
				}

				stream.on('close', (code?: number) => {
					if (code && code !== 0) {
						finalize(new Error(`SSH 命令执行失败，退出码: ${code}`));
						return;
					}

					finalize();
				}).on('data', (data: Buffer) => {
					appendOutput(Buffer.from(data).toString('utf8'));
				}).stderr.on('data', (data: Buffer) => {
					appendOutput(Buffer.from(data).toString('utf8'));
				});
			});
		}).on('error', error => {
			finalize(error instanceof Error ? error : new Error(String(error)));
		}).connect({
			host: server.host,
			port: server.port,
			username: server.username,
			password,
			readyTimeout: Math.max(5000, Math.min(timeoutSeconds * 1000, 60000))
		});
	});
}

async function runPrivateKeySshCommand(
	server: DeploymentServerProfile,
	remoteCommand: string,
	timeoutSeconds: number,
	privateKey: string
): Promise<void> {
	showOutputChannel(true);
	appendOutputLine(`$ ssh(privateKey) ${server.username}@${server.host}:${server.port} ${remoteCommand}`);

	await new Promise<void>((resolve, reject) => {
		const client = new Client();
		let settled = false;
		const timeoutHandle = setTimeout(() => {
			if (settled) {
				return;
			}

			settled = true;
			client.end();
			reject(new Error(`SSH 命令执行超时（>${timeoutSeconds} 秒）`));
		}, timeoutSeconds * 1000);

		const finalize = (error?: Error) => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeoutHandle);
			client.end();
			if (error) {
				reject(error);
				return;
			}

			appendOutputLine('');
			resolve();
		};

		client.on('ready', () => {
			client.exec(remoteCommand, (error, stream) => {
				if (error) {
					finalize(error);
					return;
				}

				stream.on('close', (code?: number) => {
					if (code && code !== 0) {
						finalize(new Error(`SSH 命令执行失败，退出码: ${code}`));
						return;
					}

					finalize();
				}).on('data', (data: Buffer) => {
					appendOutput(Buffer.from(data).toString('utf8'));
				}).stderr.on('data', (data: Buffer) => {
					appendOutput(Buffer.from(data).toString('utf8'));
				});
			});
		}).on('error', error => {
			finalize(error instanceof Error ? error : new Error(String(error)));
		}).connect({
			host: server.host,
			port: server.port,
			username: server.username,
			privateKey,
			readyTimeout: Math.max(5000, Math.min(timeoutSeconds * 1000, 60000))
		});
	});
	}

async function runServerCommand(
	server: DeploymentServerProfile,
	remoteCommand: string,
	timeoutSeconds: number,
	secretOverrides?: DeploymentRuntimeSecretOverrides
): Promise<void> {
	if (server.authType === 'password') {
		const password = secretOverrides?.password || await getDeploymentServerPassword(server.id);
		if (!password) {
			throw new Error(`服务器“${server.name}”尚未配置 SSH 密码`);
		}

		await runPasswordSshCommand(server, remoteCommand, timeoutSeconds, password);
		return;
	}

	if (server.authType === 'privateKey') {
		const privateKey = secretOverrides?.privateKey || await getDeploymentServerPrivateKey(server.id);
		if (!privateKey) {
			throw new Error(`服务器“${server.name}”尚未配置 SSH 私钥`);
		}

		await runPrivateKeySshCommand(server, remoteCommand, timeoutSeconds, privateKey);
		return;
	}

	await runSshCommand(server, remoteCommand, timeoutSeconds);
}

async function ensureRemoteDirectory(server: DeploymentServerProfile, remoteDirectory: string, secretOverrides?: DeploymentRuntimeSecretOverrides): Promise<void> {
	const remoteCommand = `mkdir -p ${quotePosix(remoteDirectory)}`;
	await runServerCommand(server, remoteCommand, 30, secretOverrides);
}

async function uploadFilesWithScp(server: DeploymentServerProfile, localFilePaths: string[], remoteDirectory: string): Promise<void> {
	showOutputChannel(true);
	appendOutputLine(`$ scp -P ${server.port} <${localFilePaths.length} files> ${server.username}@${server.host}:${remoteDirectory}`);

	await ensureRemoteDirectory(server, remoteDirectory);

	await new Promise<void>((resolve, reject) => {
		let stderrOutput = '';
		const scpArgs = [
			'-P',
			String(server.port),
			...localFilePaths,
			`${server.username}@${server.host}:${remoteDirectory.replace(/\\/g, '/')}/`
		];
		const childProcess = spawn('scp', scpArgs, {
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});

		childProcess.stdout.on('data', chunk => {
			appendOutput(Buffer.from(chunk).toString('utf8'));
		});

		childProcess.stderr.on('data', chunk => {
			const output = Buffer.from(chunk).toString('utf8');
			stderrOutput += output;
			appendOutput(output);
		});

		childProcess.on('error', error => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				reject(new Error('未找到 scp 命令，请先安装并配置系统 OpenSSH 客户端'));
				return;
			}

			reject(error);
		});

		childProcess.on('close', code => {
			if (code === 0) {
				appendOutputLine('');
				resolve();
				return;
			}

			const compactStderr = stderrOutput.trim();
			reject(new Error(compactStderr ? `SCP 上传失败: ${compactStderr}` : `SCP 上传失败，退出码: ${code ?? '未知'}`));
		});
	});
}

async function connectSshClient(server: DeploymentServerProfile, secretOverrides?: DeploymentRuntimeSecretOverrides): Promise<Client> {
	return new Promise<Client>(async (resolve, reject) => {
		const client = new Client();
		const readyTimeout = 30000;

		client.on('ready', () => {
			resolve(client);
		}).on('error', error => {
			client.end();
			reject(error instanceof Error ? error : new Error(String(error)));
		});

		try {
			if (server.authType === 'password') {
				const password = secretOverrides?.password || await getDeploymentServerPassword(server.id);
				if (!password) {
					throw new Error(`服务器“${server.name}”尚未配置 SSH 密码`);
				}

				client.connect({
					host: server.host,
					port: server.port,
					username: server.username,
					password,
					readyTimeout
				});
				return;
			}

			const privateKey = secretOverrides?.privateKey || await getDeploymentServerPrivateKey(server.id);
			if (!privateKey) {
				throw new Error(`服务器“${server.name}”尚未配置 SSH 私钥`);
			}

			client.connect({
				host: server.host,
				port: server.port,
				username: server.username,
				privateKey,
				readyTimeout
			});
		} catch (error) {
			client.end();
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

async function uploadFilesWithSftp(
	server: DeploymentServerProfile,
	localFilePaths: string[],
	remoteDirectory: string,
	secretOverrides?: DeploymentRuntimeSecretOverrides
): Promise<void> {
	showOutputChannel(true);
	appendOutputLine(`$ sftp ${server.username}@${server.host}:${server.port} -> ${remoteDirectory}`);

	await ensureRemoteDirectory(server, remoteDirectory, secretOverrides);
	const client = await connectSshClient(server, secretOverrides);

	try {
		await new Promise<void>((resolve, reject) => {
			client.sftp((error, sftp) => {
				if (error) {
					reject(error);
					return;
				}

				void (async () => {
					for (const localFilePath of localFilePaths) {
						const remoteFilePath = `${remoteDirectory.replace(/\\/g, '/').replace(/\/$/, '')}/${path.basename(localFilePath)}`;
						appendOutputLine(`[上传] ${localFilePath} -> ${remoteFilePath}`);
						await new Promise<void>((putResolve, putReject) => {
							sftp.fastPut(localFilePath, remoteFilePath, putError => {
								if (putError) {
									putReject(putError);
									return;
								}

								putResolve();
							});
						});
					}

					resolve();
				})().catch(reject);
			});
		});
	} finally {
		client.end();
	}
}

export async function testDeploymentConnection(server: DeploymentServerProfile, secretOverrides?: DeploymentRuntimeSecretOverrides): Promise<void> {
	logInfo(`开始测试部署服务器连接: ${server.name}`);
	const remoteCommand = `printf '%s\\n' ${quotePosix('__hebai_deploy_ready__')}`;
	try {
		await runServerCommand(server, remoteCommand, 20, secretOverrides);
		logInfo(`部署服务器连接测试成功: ${server.name}`);
	} catch (error) {
		const message = appendSshDiagnosis(server, '测试部署服务器连接', error);
		throw createDisplayError(message);
	}
}

export async function runDeploymentAction(server: DeploymentServerProfile, action: DeploymentAction, secretOverrides?: DeploymentRuntimeSecretOverrides): Promise<void> {
	if (runningServers.has(server.id)) {
		throw new Error(`服务器“${server.name}”已有任务在执行，请等待当前任务完成`);
	}

	runningServers.add(server.id);

	try {
		const secretEnvValues = secretOverrides?.secretEnvValues || await getDeploymentSecretEnvValues(server);
		const remoteCommand = buildRemoteCommand(server, action.command, secretEnvValues);
		logInfo(`开始执行部署动作: ${server.name} / ${action.name}`);
		try {
			await runServerCommand(server, remoteCommand, action.timeoutSeconds, secretOverrides);
		} catch (error) {
			const message = appendSshDiagnosis(server, `执行部署动作“${action.name}”`, error);
			throw createDisplayError(message);
		}
		logInfo(`部署动作执行完成: ${server.name} / ${action.name}`);
	} finally {
		runningServers.delete(server.id);
	}
}

export async function uploadFilesToDeploymentServer(
	server: DeploymentServerProfile,
	localFilePaths: string[],
	remoteDirectory: string,
	secretOverrides?: DeploymentRuntimeSecretOverrides
): Promise<void> {
	if (localFilePaths.length === 0) {
		return;
	}

	logInfo(`开始上传文件到服务器: ${server.name} -> ${remoteDirectory}`);
	try {
		if (server.authType === 'system') {
			await uploadFilesWithScp(server, localFilePaths, remoteDirectory);
		} else {
			await uploadFilesWithSftp(server, localFilePaths, remoteDirectory, secretOverrides);
		}
		logInfo(`文件上传完成: ${server.name} -> ${remoteDirectory}`);
	} catch (error) {
		const message = appendSshDiagnosis(server, '上传文件', error);
		throw createDisplayError(message);
	}
}