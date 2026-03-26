import { logDebug } from './output';

function normalizeCommandText(message: string): string {
	return message
		.trim()
		.replace(/^```(?:bash|sh|shell)?\s*/i, '')
		.replace(/```$/g, '')
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.trim();
}

function unescapeCommitSegment(value: string, quote: string): string {
	let unescaped = value;
	if (quote === '"') {
		unescaped = unescaped.replace(/\\(["\\`$])/g, '$1');
	} else {
		unescaped = unescaped.replace(/\\(['\\])/g, '$1');
	}

	return unescaped
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\r/g, '\r');
}

function extractCommitMessageFromCommand(message: string): string | null {
	const normalized = normalizeCommandText(message);

	const commandStart = normalized.search(/\bgit\s+commit\b/i);
	if (commandStart === -1) {
		return null;
	}

	const commandText = normalized.slice(commandStart);
	const matcher = /(?:^|\s)(?:-m\s+|--message(?:=|\s+))("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
	const parts: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = matcher.exec(commandText)) !== null) {
		const quotedValue = match[1];
		const quote = quotedValue[0];
		parts.push(unescapeCommitSegment(quotedValue.slice(1, -1), quote));
	}

	if (parts.length === 0) {
		return null;
	}

	return parts.join('\n\n').trim();
}

export function cleanCommitMessage(message: string): string {
	const normalized = normalizeCommandText(message);
	const commandMessage = extractCommitMessageFromCommand(message);
	if (commandMessage) {
		return commandMessage;
	}

	if (/\bgit\s+commit\b/i.test(normalized)) {
		logDebug(`AI 原始返回（标准化后）: ${normalized}`);
		throw new Error('AI 返回了 git commit 命令，但未能解析出 -m 参数中的提交信息');
	}

	return normalized;
}
