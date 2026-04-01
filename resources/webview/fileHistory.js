(function () {
	const vscode = acquireVsCodeApi();

	try {
		const encodedState = document.body.dataset.state || '';
		const binary = atob(encodedState);
		const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
		const state = JSON.parse(new TextDecoder().decode(bytes));

		const fileNameEl = document.getElementById('fileName');
		const filePathEl = document.getElementById('filePath');
		const entrySummaryEl = document.getElementById('entrySummary');
		const historyListEl = document.getElementById('historyList');
		const commitSubjectEl = document.getElementById('commitSubject');
		const commitMetaEl = document.getElementById('commitMeta');
		const diffContentEl = document.getElementById('diffContent');
		const addToChatButtonEl = document.getElementById('addToChatButton');
		const copyCommitButtonEl = document.getElementById('copyCommitButton');

		if (!fileNameEl || !filePathEl || !entrySummaryEl || !historyListEl || !commitSubjectEl || !commitMetaEl || !diffContentEl || !copyCommitButtonEl || !addToChatButtonEl) {
			throw new Error('文件历史面板初始化失败：缺少必要的 DOM 节点');
		}

		let activeIndex = 0;
		let copyButtonResetTimer = null;
		let addToChatResetTimer = null;

		fileNameEl.textContent = state.fileName;
		filePathEl.textContent = state.relativePath + '  ·  ' + state.workspaceName;
		entrySummaryEl.textContent = '共 ' + state.entries.length + ' 条提交';

		function getLineClass(line) {
			if (line.startsWith('+')) {
				return 'diff-line diff-line--add';
			}

			if (line.startsWith('-')) {
				return 'diff-line diff-line--del';
			}

			return 'diff-line';
		}

		function extractVisibleDiffLines(patch) {
			const visibleLines = [];
			let insideHunk = false;

			for (const line of patch.split(/\r?\n/)) {
				if (line.startsWith('@@')) {
					insideHunk = true;
					continue;
				}

				if (!insideHunk) {
					continue;
				}

				if (line === '\\ No newline at end of file') {
					continue;
				}

				if (line.startsWith('+') || line.startsWith('-')) {
					visibleLines.push(line);
				}
			}

			return visibleLines;
		}

		function getActiveEntry() {
			return state.entries[activeIndex];
		}

		function resetCopyButtonLabel() {
			copyCommitButtonEl.textContent = '复制提交 ID';
			copyCommitButtonEl.classList.remove('is-copied');
		}

		function resetAddToChatButtonLabel() {
			addToChatButtonEl.textContent = '发送到 Copilot Chat';
			addToChatButtonEl.classList.remove('is-added');
		}

		function setCopyButtonCopied() {
			copyCommitButtonEl.textContent = '已复制';
			copyCommitButtonEl.classList.add('is-copied');
			if (copyButtonResetTimer) {
				clearTimeout(copyButtonResetTimer);
			}
			copyButtonResetTimer = setTimeout(function () {
				resetCopyButtonLabel();
			}, 1500);
		}

		function setAddToChatAdded() {
			addToChatButtonEl.textContent = '已发送';
			addToChatButtonEl.classList.add('is-added');
			if (addToChatResetTimer) {
				clearTimeout(addToChatResetTimer);
			}
			addToChatResetTimer = setTimeout(function () {
				resetAddToChatButtonLabel();
			}, 1800);
		}

		function renderDiff(entry) {
			commitSubjectEl.textContent = entry.subject || '(无提交标题)';
			commitMetaEl.textContent = entry.shortHash + '  ·  ' + entry.authorName + '  ·  ' + entry.commitDate;
			resetAddToChatButtonLabel();
			resetCopyButtonLabel();
			diffContentEl.replaceChildren();

			if (!entry.patch) {
				const empty = document.createElement('p');
				empty.className = 'diff-empty';
				empty.textContent = '该提交没有可显示的文件补丁内容。';
				diffContentEl.appendChild(empty);
				return;
			}

			const visibleLines = extractVisibleDiffLines(entry.patch);
			if (visibleLines.length === 0) {
				const empty = document.createElement('p');
				empty.className = 'diff-empty';
				empty.textContent = '该提交没有可显示的增减代码。';
				diffContentEl.appendChild(empty);
				return;
			}

			for (const line of visibleLines) {
				const lineEl = document.createElement('div');
				lineEl.className = getLineClass(line);
				lineEl.textContent = line;
				diffContentEl.appendChild(lineEl);
			}

			diffContentEl.scrollTop = 0;
		}

		function renderHistoryList() {
			historyListEl.replaceChildren();

			state.entries.forEach((entry, index) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'history-item' + (index === activeIndex ? ' active' : '');
				button.addEventListener('click', function () {
					activeIndex = index;
					renderHistoryList();
					renderDiff(entry);
				});

				const subject = document.createElement('div');
				subject.className = 'history-item__subject';
				subject.textContent = entry.subject || '(无提交标题)';

				const meta = document.createElement('div');
				meta.className = 'history-item__meta';

				const author = document.createElement('span');
				author.textContent = entry.authorName;

				const date = document.createElement('span');
				date.textContent = entry.commitDate + '  ' + entry.shortHash;

				meta.append(author, date);
				button.append(subject, meta);
				historyListEl.appendChild(button);
			});
		}

		copyCommitButtonEl.addEventListener('click', function () {
			const activeEntry = getActiveEntry();
			if (!activeEntry || !activeEntry.commitHash) {
				return;
			}

			vscode.postMessage({
				type: 'copyCommitHash',
				commitHash: activeEntry.commitHash,
				shortHash: activeEntry.shortHash
			});
			setCopyButtonCopied();
		});

		addToChatButtonEl.addEventListener('click', function () {
			const activeEntry = getActiveEntry();
			if (!activeEntry) {
				return;
			}

			vscode.postMessage({
				type: 'addCommitToChat',
				entry: activeEntry,
				fileUri: state.fileUri,
				fileName: state.fileName,
				relativePath: state.relativePath,
				workspaceName: state.workspaceName
			});
			setAddToChatAdded();
		});

		renderHistoryList();
		renderDiff(state.entries[0]);
	} catch (error) {
		const message = error instanceof Error ? error.stack || error.message : String(error);
		const diffContentEl = document.getElementById('diffContent');
		const historyListEl = document.getElementById('historyList');
		const commitSubjectEl = document.getElementById('commitSubject');

		if (historyListEl) {
			historyListEl.textContent = '';
		}

		if (commitSubjectEl) {
			commitSubjectEl.textContent = '文件历史渲染失败';
		}

		if (diffContentEl) {
			diffContentEl.textContent = message;
			diffContentEl.classList.add('diff-error');
		}

		vscode.postMessage({ type: 'renderError', message: message });
	}
})();