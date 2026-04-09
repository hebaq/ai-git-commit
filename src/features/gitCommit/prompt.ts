import { analyzeDiffSummary } from './diffAnalysis';
import { PROMPT_DIFF_BLOCK_MAX_CHARS, PROMPT_DIFF_MAX_BLOCKS, PROMPT_DIFF_MAX_CHARS } from './constants';
import type { AIConfig } from './types';
import type { GitCommitEntry } from './git';

function splitDiffIntoBlocks(diffOutput: string): string[] {
	const lines = diffOutput.split('\n');
	const blocks: string[] = [];
	let currentBlock: string[] = [];

	for (const line of lines) {
		if (line.startsWith('diff --git ') && currentBlock.length > 0) {
			blocks.push(currentBlock.join('\n'));
			currentBlock = [line];
			continue;
		}

		currentBlock.push(line);
	}

	if (currentBlock.length > 0) {
		blocks.push(currentBlock.join('\n'));
	}

	return blocks.filter(Boolean);
}

function truncateBlock(block: string, maxChars: number): string {
	if (block.length <= maxChars) {
		return block;
	}

	const lines = block.split('\n');
	const keptLines: string[] = [];
	let currentLength = 0;
	const marker = '... [该文件剩余 diff 已截断]';

	for (const line of lines) {
		const nextLength = currentLength + line.length + 1;
		if (nextLength + marker.length > maxChars) {
			break;
		}

		keptLines.push(line);
		currentLength = nextLength;
	}

	keptLines.push(marker);
	return keptLines.join('\n');
}

function truncateDiffForPrompt(diffOutput: string): { text: string; wasTruncated: boolean; } {
	if (diffOutput.length <= PROMPT_DIFF_MAX_CHARS) {
		return {
			text: diffOutput,
			wasTruncated: false
		};
	}

	const blocks = splitDiffIntoBlocks(diffOutput);
	const selectedBlocks: string[] = [];
	let usedChars = 0;
	let consumedBlocks = 0;

	for (const block of blocks) {
		if (consumedBlocks >= PROMPT_DIFF_MAX_BLOCKS || usedChars >= PROMPT_DIFF_MAX_CHARS) {
			break;
		}

		const remainingChars = PROMPT_DIFF_MAX_CHARS - usedChars;
		const blockBudget = Math.min(PROMPT_DIFF_BLOCK_MAX_CHARS, remainingChars);
		if (blockBudget <= 64) {
			break;
		}

		const truncatedBlock = truncateBlock(block, blockBudget);
		selectedBlocks.push(truncatedBlock);
		usedChars += truncatedBlock.length + 1;
		consumedBlocks++;
	}

	const omittedBlocks = Math.max(blocks.length - consumedBlocks, 0);
	if (omittedBlocks > 0) {
		selectedBlocks.push(`... [其余 ${omittedBlocks} 个文件的 diff 已省略，以控制 token 开销]`);
	}

	return {
		text: selectedBlocks.join('\n'),
		wasTruncated: true
	};
}

export function buildPrompt(diffOutput: string, recentCommits: GitCommitEntry[], config: AIConfig): string {
	const diffSummary = analyzeDiffSummary(diffOutput);
	const truncatedDiff = truncateDiffForPrompt(diffOutput);
	const fileSummary = diffSummary.modifiedFiles.slice(0, 8).join(', ') || '未识别修改文件';
	const scopeHintText = diffSummary.scopeHints.length > 0 ? diffSummary.scopeHints.join(', ') : '无明确 scope 时请省略';
	const signalHints = [
		diffSummary.hasDocsOnlyChanges ? '- 仅涉及文档文件，优先考虑 docs。' : '',
		diffSummary.hasTestsOnlyChanges ? '- 仅涉及测试文件，优先考虑 test。' : '',
		diffSummary.hasCiChanges ? '- 涉及 CI/CD 文件，优先考虑 ci。' : '',
		diffSummary.hasConfigChanges ? '- 涉及依赖、构建或配置文件，优先考虑 build 或 chore。' : '',
		diffSummary.hasBreakingChange ? '- 可能存在破坏性变更，只有在 diff 明确体现兼容性破坏时才使用 !。' : ''
	].filter(Boolean);

	const lines: string[] = [
		'你是一个专业的 Git 提交命令生成助手。请根据以下代码变更生成一条 git commit 命令。',
		'',
		'变更摘要：',
		`- 修改文件：${fileSummary}`,
		`- 新增行数：${diffSummary.addedLines}`,
		`- 删除行数：${diffSummary.removedLines}`,
		`- 候选 scope：${scopeHintText}`
	];

	if (signalHints.length > 0) {
		lines.push(...signalHints);
	}

	if (truncatedDiff.wasTruncated) {
		lines.push('- diff 已按 token 预算裁剪，优先保留文件边界和前部变更块。');
	}

	if (recentCommits.length > 0) {
		lines.push(
			'',
			'最近提交历史（参考项目提交风格）：'
		);
		recentCommits.slice(0, 5).forEach(commit => {
			lines.push(`- ${commit.subject}`);
		});
	}

	lines.push(
		'',
		'代码变更：',
		'```diff',
		truncatedDiff.text,
		'```',
		'',
		'严格要求：',
		'1. 只返回一条完整的 git commit 命令，不要解释，不要代码块，不要额外文字。',
		'2. 命令格式必须是 git commit -m "<header>"，如果正文确实有价值，再追加一个或多个 -m "<body>"。',
		'3. header 必须遵循 Conventional Commits：<type>(<scope>): <subject>。scope 可选。',
		'4. 提交信息必须使用中文，使用祈使语气，聚焦变更结果，不要编造需求、Bug 编号或未出现在 diff 中的背景。',
		'5. subject 尽量控制在 72 个字符以内，不要写“更新代码”“修改文件”这类空泛描述。',
		'6. type 只能从 feat、fix、docs、style、refactor、perf、test、build、chore、ci、revert 中选择。',
		'7. 只有存在明确不兼容变更时才允许使用 !。',
		'8. 如果正文没有明显增量信息，只输出一个 -m 参数。',
		'',
		'输出示例：',
		'git commit -m "feat(auth): 添加登录状态持久化"',
		'git commit -m "fix(api): 修复提交信息解析截断问题" -m "改为要求模型返回 git commit 命令并从 -m 参数中提取完整提交信息"'
	);

	return lines.join('\n');
}
