import * as vscode from 'vscode';

import { CONFIG_NAMESPACE, ENABLE_DEBUG_LOGS_SETTING, OUTPUT_CHANNEL_NAME } from './constants';

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
	}

	return outputChannel;
}

function formatLogLine(level: 'INFO' | 'DEBUG' | 'ERROR', message: string): string {
	const timestamp = new Date().toLocaleTimeString('zh-CN', {
		hour12: false
	});

	return `[${timestamp}] [${level}] ${message}`;
}

function shouldLogDebug(): boolean {
	return vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<boolean>(ENABLE_DEBUG_LOGS_SETTING, false);
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.stack || error.message;
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

export function logInfo(message: string): void {
	console.log(message);
	getOutputChannel().appendLine(formatLogLine('INFO', message));
}

export function logDebug(message: string): void {
	console.log(message);
	if (!shouldLogDebug()) {
		return;
	}

	getOutputChannel().appendLine(formatLogLine('DEBUG', message));
}

export function logError(message: string, error?: unknown): void {
	console.error(message, error);
	const channel = getOutputChannel();
	channel.appendLine(formatLogLine('ERROR', message));

	if (error !== undefined) {
		channel.appendLine(formatLogLine('ERROR', normalizeError(error)));
	}
}

export function logGeneratedCommitMessage(message: string): void {
	const channel = getOutputChannel();
	channel.appendLine(formatLogLine('INFO', '生成的提交信息:'));

	for (const line of message.split(/\r?\n/)) {
		channel.appendLine(line);
	}

	channel.appendLine('');
}

export function appendOutput(value: string): void {
	getOutputChannel().append(value);
}

export function appendOutputLine(value: string): void {
	getOutputChannel().appendLine(value);
}

export function showOutputChannel(preserveFocus = true): void {
	getOutputChannel().show(preserveFocus);
}

export function disposeOutputChannel(): void {
	outputChannel?.dispose();
	outputChannel = undefined;
}